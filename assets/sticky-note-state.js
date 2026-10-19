function createStickyNoteState(savedValue = '') {
  return {
    savedValue,
    draftValue: savedValue,
    dirty: false,
    status: '已保存',
  };
}

function updateStickyNoteDraft(state, draftValue) {
  const dirty = draftValue !== state.savedValue;
  return {
    ...state,
    draftValue,
    dirty,
    status: dirty ? '有未保存修改' : '已保存',
  };
}

function saveStickyNoteDraft(state) {
  return {
    valueToPersist: state.draftValue,
    nextState: {
      savedValue: state.draftValue,
      draftValue: state.draftValue,
      dirty: false,
      status: '已保存',
    },
  };
}

function discardStickyNoteDraft(state) {
  return {
    savedValue: state.savedValue,
    draftValue: state.savedValue,
    dirty: false,
    status: '已放弃未保存修改',
  };
}

const stickyNoteState = {
  createStickyNoteState,
  updateStickyNoteDraft,
  saveStickyNoteDraft,
  discardStickyNoteDraft,
};

if (typeof window !== 'undefined') {
  window.stickyNoteState = stickyNoteState;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = stickyNoteState;
}
