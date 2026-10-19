import test from 'node:test';
import assert from 'node:assert/strict';
import stickyNoteState from '../assets/sticky-note-state.js';

const {
  createStickyNoteState,
  updateStickyNoteDraft,
  saveStickyNoteDraft,
  discardStickyNoteDraft,
} = stickyNoteState;

test('editing a date-specific note marks it as having unsaved changes', () => {
  const initial = createStickyNoteState('给自己留一点余地。');
  const edited = updateStickyNoteDraft(initial, '给明天的自己：先吃饭。');

  assert.equal(edited.dirty, true);
  assert.equal(edited.status, '有未保存修改');
  assert.equal(edited.savedValue, '给自己留一点余地。');
});

test('saving a note commits the current draft and clears the dirty state', () => {
  const initial = createStickyNoteState('');
  const edited = updateStickyNoteDraft(initial, '未来的我，先完成最重要的一件事。');
  const saved = saveStickyNoteDraft(edited);

  assert.equal(saved.valueToPersist, '未来的我，先完成最重要的一件事。');
  assert.equal(saved.nextState.dirty, false);
  assert.equal(saved.nextState.status, '已保存');
});

test('discarding changes restores the saved note before switching dates', () => {
  const initial = createStickyNoteState('原本的内容');
  const edited = updateStickyNoteDraft(initial, '还没有保存的新内容');
  const discarded = discardStickyNoteDraft(edited);

  assert.equal(discarded.draftValue, '原本的内容');
  assert.equal(discarded.dirty, false);
  assert.equal(discarded.status, '已放弃未保存修改');
});
