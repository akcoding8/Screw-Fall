import { formatScore } from './ScoreFormatter.js';
import { MAX_LEVEL, ADJUSTMENT_REASONS, STARTING_LEVEL_RECORD_ID } from './ProgressModel.js';
import { processEvidenceImage } from './EvidenceImageProcessor.js';
import { PendingOperations } from './PendingOperations.js';

const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatScore(Math.abs(value))}`;
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateText = value => value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : '';

/** Optional provenance UI lives behind Settings. Transactions remain in the
 * progress model; files remain in the asynchronous evidence store. */
export class ProgressPanel {
  constructor({ element, progress, input, store, getStore = () => store, viewer, canOpen, onChange = () => {}, onOpenChange = () => {},
    processImage = processEvidenceImage, urlAPI = globalThis.URL, onActivityChange = () => {} }) {
    Object.assign(this, { element, progress, input, store, getStore, viewer, canOpen, onChange, onOpenChange, processImage, urlAPI, onActivityChange });
    this.dialog = element.querySelector('#progress-panel');
    this.trigger = element.querySelector('#progress-open');
    this.nodes = Object.fromEntries(['heading','back','done','current','starting','completed','adjustments','evidence-count','import','adjust','history-open',
      'question-text','yes','no','form-help','number-label','number','range','reason-row','reason','note','source','file','file-status','thumbnail','file-clear',
      'preview','preview-values','record-notice','confirm','history-list','history-total','remove-confirm','remove-cancel','error','status',
      'attachment-heading','attachment-thumbnail','attachment-confirm','attachment-cancel']
      .map(id => [id, element.querySelector(`#progress-${id}`)]));
    this.panes = Object.fromEntries(['overview','question','form','review','history','remove','attachment'].map(id => [id, element.querySelector(`#progress-${id}`)]));
    this.historyFile = element.querySelector('#history-file');
    this.listeners = []; this.operation = 0; this.pendingImage = null; this.busy = false; this.thumbnailUrl = null;
    this.pendingCleanup = new Map(); this.disposed = false;
    this.activity = new PendingOperations(onActivityChange);
    // Track the complete operations, including reference commits and cleanup
    // after a cancelled dialog, so a requested PWA restart can drain them.
    for (const name of ['prepareFile', 'confirm', 'attachEvidence', 'confirmEvidence', 'removeEvidence', 'cleanupEvidence']) {
      const operation = this[name].bind(this);
      this[name] = (...args) => this.activity.track(() => operation(...args));
    }
    this.listen(this.trigger, 'pointerdown', e => { input.blockPointer(e.pointerId); e.stopPropagation(); });
    this.listen(this.trigger, 'click', () => this.open());
    this.listen(this.dialog, 'pointerdown', e => { input.blockPointer(e.pointerId); e.stopPropagation(); });
    for (const type of ['pointermove','pointerup','pointercancel','click']) this.listen(this.dialog, type, e => e.stopPropagation());
    this.listen(this.dialog, 'cancel', e => { e.preventDefault(); this.close(); });
    this.listen(this.dialog, 'close', () => this.finishClose());
    this.listen(this.nodes.done, 'click', () => this.close());
    this.listen(this.nodes.back, 'click', () => this.back());
    this.listen(this.nodes.import, 'click', () => this.startImport());
    this.listen(this.nodes.adjust, 'click', () => this.startAdjustment());
    this.listen(this.nodes['history-open'], 'click', () => this.showHistory());
    this.listen(this.nodes.yes, 'click', () => {
      if (this.question === 1) { this.question = 2; this.nodes['question-text'].textContent = 'Did you build up a level number you would like to continue from?'; }
      else this.show('form');
    });
    this.listen(this.nodes.no, 'click', () => this.show('overview'));
    this.listen(this.nodes.file, 'change', () => this.prepareFile(this.nodes.file.files?.[0]));
    this.listen(this.nodes['file-clear'], 'click', () => { this.cancelOperation(); this.clearPending(); this.setBusy(false); });
    this.listen(this.nodes.preview, 'click', () => this.review());
    this.listen(this.nodes.confirm, 'click', () => this.confirm());
    this.listen(this.nodes['history-list'], 'click', event => this.historyAction(event));
    this.listen(this.historyFile, 'change', () => this.attachEvidence(this.historyFile.files?.[0]));
    this.listen(this.nodes['remove-confirm'], 'click', () => this.removeEvidence());
    this.listen(this.nodes['remove-cancel'], 'click', () => this.showHistory());
    this.listen(this.nodes['attachment-confirm'], 'click', () => this.confirmEvidence());
    this.listen(this.nodes['attachment-cancel'], 'click', () => { this.cancelOperation(); this.clearAttachment(); this.setBusy(false); this.showHistory(); });
    this.nodes.range.textContent = `Whole levels from 1 to ${formatScore(MAX_LEVEL)}. The resulting current level must stay in this range.`;
  }
  listen(target, type, fn) { target.addEventListener(type, fn); this.listeners.push({ target, type, fn }); }
  get isOpen() { return this.dialog.open; }
  get pendingOperations() { return this.activity.count; }
  whenIdle() { return this.activity.whenIdle(); }
  setBusy(value) {
    this.busy = value;
    for (const key of ['preview','confirm','file','remove-confirm','remove-cancel','attachment-confirm','import','adjust','history-open','back']) this.nodes[key].disabled = value;
    this.onActivityChange();
  }
  cancelOperation() { this.operation++; this.processingAbort?.abort(); this.processingAbort = null; }
  beginOperation() {
    this.cancelOperation(); this.processingAbort = new AbortController();
    return { token: this.operation, store: this.getStore(), eligible: this.progress.scoring?.eligible, signal: this.processingAbort.signal };
  }
  operationCurrent(context) {
    return !this.disposed && this.isOpen && context.token === this.operation
      && context.eligible === this.progress.scoring?.eligible;
  }
  async cleanupEvidence(id, store) {
    if (!id) return true;
    try {
      await store.delete(id); this.pendingCleanup.get(store)?.delete(id); return true;
    } catch {
      if (!this.pendingCleanup.has(store)) this.pendingCleanup.set(store, new Set());
      this.pendingCleanup.get(store).add(id); return false;
    }
  }
  retryCleanup() {
    for (const [store, ids] of this.pendingCleanup) for (const id of ids) void this.cleanupEvidence(id, store);
  }
  open() {
    if (this.disposed || this.isOpen || !this.canOpen()) return false;
    this.input.invalidateGesture(); this.refresh(); this.show('overview'); this.dialog.showModal();
    this.openNotified = true; this.trigger.setAttribute('aria-expanded', 'true'); this.onOpenChange(true); this.nodes.done.focus(); this.retryCleanup(); return true;
  }
  show(name) {
    this.view = name;
    for (const [id, node] of Object.entries(this.panes)) node.hidden = id !== name;
    this.nodes.back.hidden = name === 'overview';
    this.nodes.heading.textContent = name === 'history' ? 'History' : 'Progress';
    this.nodes.error.textContent = ''; this.nodes.status.textContent = '';
    this.dialog.querySelector('.progress-scroll').scrollTop = 0;
    this.onActivityChange();
  }
  refresh() {
    const data = this.progress.data;
    this.nodes.current.textContent = formatScore(this.progress.currentLevel);
    this.nodes.starting.textContent = formatScore(data.startingLevel);
    this.nodes.completed.textContent = formatScore(data.levelsCompletedHere);
    this.nodes.adjustments.textContent = signed(this.progress.adjustmentTotal);
    this.nodes['evidence-count'].textContent = String(Number(Boolean(data.startingLevelEvidenceId)) + data.laterImportedAdjustments.filter(item => item.evidenceId).length);
    this.nodes.import.hidden = this.progress.startingLevelConfirmed;
  }
  clearPending() {
    this.pendingImage = null; this.nodes.file.value = ''; this.nodes['file-status'].textContent = '';
    if (this.thumbnailUrl) this.urlAPI.revokeObjectURL(this.thumbnailUrl);
    this.thumbnailUrl = null; this.nodes.thumbnail.removeAttribute('src'); this.nodes.thumbnail.hidden = true; this.nodes['file-clear'].hidden = true;
  }
  clearAttachment() {
    this.pendingAttachment = null; this.historyFile.value = '';
    if (this.attachmentThumbnailUrl) this.urlAPI.revokeObjectURL(this.attachmentThumbnailUrl);
    this.attachmentThumbnailUrl = null; this.nodes['attachment-thumbnail'].removeAttribute('src');
  }
  resetForm(mode) {
    this.mode = mode; this.cancelOperation(); this.clearPending(); this.clearAttachment(); this.reviewValues = null; this.setBusy(false);
    this.nodes.number.value = ''; this.nodes.source.value = ''; this.nodes.note.value = ''; this.nodes.reason.value = 'elsewhere';
    this.nodes.number.inputMode = mode === 'starting' ? 'numeric' : 'text';
    this.nodes['number-label'].textContent = mode === 'starting' ? 'Starting level' : 'Level adjustment (for example +32 or -10)';
    this.nodes['reason-row'].hidden = mode === 'starting';
    this.nodes['form-help'].textContent = mode === 'starting'
      ? 'Your starting level is recorded separately from levels completed in Screw Fall. Points, scores and skins are never imported.'
      : 'Add progress completed elsewhere or correct an earlier entry. Each change stays in your history.';
  }
  startImport() {
    if (!this.isOpen || this.busy || this.progress.startingLevelConfirmed) return false;
    this.resetForm('starting'); this.question = 1; this.nodes['question-text'].textContent = 'Have you played a similar tower game before?'; this.show('question');
  }
  startAdjustment() { if (!this.isOpen || this.busy) return false; this.resetForm('adjustment'); this.show('form'); this.nodes.number.focus(); }
  formValues() {
    return this.mode === 'starting' ? { startingLevel: this.nodes.number.value, source: this.nodes.source.value }
      : { amount: this.nodes.number.value, reason: this.nodes.reason.value, note: this.nodes.note.value, source: this.nodes.source.value };
  }
  preview(values) { return this.mode === 'starting' ? this.progress.previewStartingLevel(values) : this.progress.previewAdjustment(values); }
  review() {
    if (!this.isOpen || this.busy || this.view !== 'form') return false;
    const values = this.formValues(), result = this.preview(values);
    if (!result.ok) { this.nodes.error.textContent = result.error; return false; }
    this.reviewValues = Object.freeze(values); this.show('review'); this.nodes['preview-values'].replaceChildren();
    this.addValue(this.nodes['preview-values'], 'Current level now', formatScore(result.before));
    this.addValue(this.nodes['preview-values'], this.mode === 'starting' ? 'Imported starting level' : 'Adjustment', this.mode === 'starting' ? formatScore(result.startingLevel) : signed(result.amount));
    this.addValue(this.nodes['preview-values'], 'Levels completed here', formatScore(this.progress.data.levelsCompletedHere));
    this.addValue(this.nodes['preview-values'], 'Resulting current level', formatScore(result.after));
    this.nodes['record-notice'].textContent = this.mode === 'starting' ? 'This starting-level record will be kept. Later corrections are added as adjustments.' : 'This adjustment will be kept. You can add a correcting entry later.';
    this.nodes.confirm.focus(); return true;
  }
  async prepareFile(file) {
    if (!this.isOpen || this.view !== 'form') return false;
    const context = this.beginOperation(); this.clearPending(); this.setBusy(false); if (!file) return false;
    this.setBusy(true); this.nodes['file-status'].textContent = 'Preparing screenshot…';
    try {
      const processed = await this.processImage(file, { signal: context.signal });
      if (!this.operationCurrent(context)) return false;
      this.pendingImage = processed; this.thumbnailUrl = this.urlAPI.createObjectURL(processed.thumbnail);
      this.nodes.thumbnail.src = this.thumbnailUrl; this.nodes.thumbnail.hidden = false; this.nodes['file-clear'].hidden = false;
      this.nodes['file-status'].textContent = 'Screenshot ready. It stays in this browser.';
      return true;
    } catch (error) {
      if (this.operationCurrent(context)) this.nodes['file-status'].textContent = `${error.message} You can continue without a screenshot.`;
      return false;
    } finally { if (context.token === this.operation) this.setBusy(false); }
  }
  async confirm() {
    if (this.busy || this.view !== 'review' || !this.isOpen) return false;
    const preview = this.preview(this.reviewValues);
    if (!preview.ok) { this.nodes.error.textContent = preview.error; return false; }
    const context = this.beginOperation(); this.setBusy(true); let evidence = null, evidenceWarning = '';
    try {
      if (this.pendingImage) {
        try { evidence = await context.store.put(this.pendingImage); }
        catch (error) { evidenceWarning = `Progress saved without a screenshot. ${error.message}`; }
      }
      if (!this.operationCurrent(context)) { if (evidence) await this.cleanupEvidence(evidence.id, context.store); return false; }
      const values = { ...this.reviewValues, evidenceId: evidence?.id || null };
      const result = this.mode === 'starting' ? this.progress.confirmStartingLevel(values) : this.progress.addAdjustment(values);
      if (!result.ok) { if (evidence) await this.cleanupEvidence(evidence.id, context.store); if (this.operationCurrent(context)) this.nodes.error.textContent = result.error; return false; }
      this.clearPending(); this.onChange(result); this.refresh(); this.show('overview');
      this.nodes.status.textContent = evidenceWarning || 'Progress updated.'; return true;
    } finally { if (context.token === this.operation) this.setBusy(false); }
  }
  addValue(parent, label, value) {
    const doc = parent.ownerDocument, row = doc.createElement('div'), dt = doc.createElement('dt'), dd = doc.createElement('dd');
    dt.textContent = label; dd.textContent = value; row.append(dt, dd); parent.append(row);
  }
  record(id) {
    const data = this.progress.data;
    return id === STARTING_LEVEL_RECORD_ID ? { id, evidenceId: data.startingLevelEvidenceId } : data.laterImportedAdjustments.find(item => item.id === id);
  }
  showHistory() {
    this.show('history'); const list = this.nodes['history-list'], doc = list.ownerDocument, data = this.progress.data;
    list.replaceChildren();
    const rows = [{ id: STARTING_LEVEL_RECORD_ID, title: `Started at Level ${formatScore(data.startingLevel)}`, createdAt: data.startingLevelConfirmedAt, source: data.startingLevelSource, evidenceId: data.startingLevelEvidenceId },
      ...data.laterImportedAdjustments.map(item => ({ ...item, title: `${signed(item.amount)} — ${ADJUSTMENT_REASONS[item.reason] || item.reason}` }))];
    for (const row of rows) {
      const section = doc.createElement('article'); section.className = 'progress-record';
      const heading = doc.createElement('h3'); heading.textContent = row.title; section.append(heading);
      for (const text of [dateText(row.createdAt), row.source, row.note, row.evidenceId ? 'Screenshot attached' : '']) if (text) { const line = doc.createElement('p'); line.textContent = text; section.append(line); }
      const actions = doc.createElement('div'); actions.className = 'record-actions';
      for (const [action, label] of row.evidenceId ? [['view','View screenshot'],['attach','Replace screenshot'],['remove','Remove screenshot']] : [['attach','Add screenshot']]) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.dataset.record = row.id; button.dataset.action = action; button.textContent = label; actions.append(button);
      }
      section.append(actions); list.append(section);
    }
    this.nodes['history-total'].textContent = `Total later imported progress: ${signed(this.progress.adjustmentTotal)}`;
  }
  historyAction(event) {
    const button = event.target.closest('button[data-record]'); if (!this.isOpen || this.view !== 'history' || !button || this.busy) return;
    const record = this.record(button.dataset.record); if (!record) return;
    this.evidenceRecord = record.id;
    if (button.dataset.action === 'view') this.viewer.open(record.evidenceId, { returnFocus: button });
    if (button.dataset.action === 'attach') { this.historyFile.value = ''; this.historyFile.click(); }
    if (button.dataset.action === 'remove') this.show('remove');
  }
  async attachEvidence(file) {
    if (!this.isOpen || this.view !== 'history' || !file || this.busy) return false;
    const record = this.record(this.evidenceRecord); if (!record) return;
    const context = this.beginOperation(); this.setBusy(true); this.nodes.status.textContent = 'Preparing screenshot…';
    try {
      const processed = await this.processImage(file, { signal: context.signal });
      if (!this.operationCurrent(context)) return false;
      this.clearAttachment();
      this.pendingAttachment = { recordId: record.id, previousEvidenceId: record.evidenceId, processed };
      this.attachmentThumbnailUrl = this.urlAPI.createObjectURL(processed.thumbnail);
      this.nodes['attachment-thumbnail'].src = this.attachmentThumbnailUrl;
      this.nodes['attachment-heading'].textContent = record.evidenceId ? 'Replace this screenshot?' : 'Attach this screenshot?';
      this.nodes['attachment-confirm'].textContent = record.evidenceId ? 'Replace screenshot' : 'Attach screenshot';
      this.show('attachment'); this.nodes['attachment-confirm'].focus(); return true;
    } catch (error) { if (this.operationCurrent(context)) this.nodes.error.textContent = error.message; return false; }
    finally { if (context.token === this.operation) this.setBusy(false); }
  }
  async confirmEvidence() {
    if (!this.isOpen || this.view !== 'attachment' || this.busy || !this.pendingAttachment) return false;
    const attachment = this.pendingAttachment, record = this.record(attachment.recordId);
    if (!record || record.evidenceId !== attachment.previousEvidenceId) {
      this.nodes.error.textContent = 'This screenshot changed. Choose it again from History.'; return false;
    }
    const context = this.beginOperation(); this.setBusy(true);
    try {
      const saved = await context.store.put(attachment.processed);
      if (!this.operationCurrent(context)) { await this.cleanupEvidence(saved.id, context.store); return false; }
      if (this.record(record.id)?.evidenceId !== attachment.previousEvidenceId) {
        await this.cleanupEvidence(saved.id, context.store);
        if (this.operationCurrent(context)) this.nodes.error.textContent = 'This screenshot changed. Choose it again from History.';
        return false;
      }
      const result = this.progress.setEvidence(record.id, saved.id);
      if (!result.ok) {
        await this.cleanupEvidence(saved.id, context.store);
        if (this.operationCurrent(context)) this.nodes.error.textContent = result.error;
        return false;
      }
      // The reference commits first. Closing during cleanup can never attach an
      // image later, and a failed upload never destroys the existing screenshot.
      this.clearAttachment();
      const cleaned = await this.cleanupEvidence(record.evidenceId, context.store);
      if (this.operationCurrent(context)) {
        this.refresh(); this.showHistory();
        this.nodes.status.textContent = cleaned ? 'Screenshot saved.' : 'Screenshot saved. Old image cleanup will be retried when you open Progress.';
      }
      return true;
    } catch (error) { if (this.operationCurrent(context)) this.nodes.error.textContent = error.message; return false; }
    finally { if (context.token === this.operation) this.setBusy(false); }
  }
  async removeEvidence() {
    if (!this.isOpen || this.view !== 'remove' || this.busy) return false;
    const record = this.record(this.evidenceRecord); if (!record?.evidenceId) return false;
    const context = this.beginOperation(); this.setBusy(true);
    // Explicit confirmation commits the reference change synchronously. The
    // following asynchronous cleanup has no ability to change progress later.
    const result = this.progress.setEvidence(record.id, null);
    if (!result.ok) { this.nodes.error.textContent = result.error; this.setBusy(false); return false; }
    const cleaned = await this.cleanupEvidence(record.evidenceId, context.store);
    if (this.operationCurrent(context)) {
      this.refresh(); this.showHistory();
      this.nodes.status.textContent = cleaned ? 'Screenshot removed.' : 'Screenshot removed. Local image cleanup will be retried when you open Progress.';
    }
    if (context.token === this.operation) this.setBusy(false);
    return true;
  }
  back() {
    if (this.busy) return;
    if (this.view === 'review') { this.reviewValues = null; this.show('form'); }
    else if (this.view === 'attachment') { this.cancelOperation(); this.clearAttachment(); this.showHistory(); }
    else { this.cancelOperation(); this.clearPending(); this.clearAttachment(); this.refresh(); this.show('overview'); }
  }
  close() { this.viewer.close(); if (this.isOpen) this.dialog.close(); this.finishClose(); }
  finishClose() {
    if (!this.openNotified || this.isOpen) return;
    this.openNotified = false; this.cancelOperation(); this.clearPending(); this.clearAttachment(); this.reviewValues = null; this.setBusy(false); this.input.invalidateGesture();
    this.trigger.setAttribute('aria-expanded', 'false'); this.onOpenChange(false); this.trigger.focus();
  }
  dispose() { this.close(); this.disposed = true; for (const { target, type, fn } of this.listeners) target.removeEventListener(type, fn); this.listeners.length = 0; }
}
