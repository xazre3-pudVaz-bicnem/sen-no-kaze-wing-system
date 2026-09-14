export type BaseMasterAccessKind = 'editor' | 'owner_viewer' | 'shared_viewer';

export interface BaseMasterDetailViewInput {
  canEdit: boolean;
  canViewOwned: boolean;
  draftId: string | null;
  currentId: string | null;
  requestedRevisionId?: string | null;
  visibleRevisionIds: string[];
}

export interface BaseMasterDetailView {
  accessKind: BaseMasterAccessKind;
  editableRevisionId: string | null;
  readOnlyRevisionIds: string[];
}

export function resolveBaseMasterDetailView(input: BaseMasterDetailViewInput): BaseMasterDetailView {
  const visible = new Set(input.visibleRevisionIds);
  const accessKind: BaseMasterAccessKind =
    input.canEdit ? 'editor' : input.canViewOwned ? 'owner_viewer' : 'shared_viewer';

  const editableRevisionId = input.canEdit && input.draftId && visible.has(input.draftId)
    ? input.draftId
    : null;

  if (
    input.requestedRevisionId &&
    visible.has(input.requestedRevisionId) &&
    input.requestedRevisionId !== editableRevisionId
  ) {
    return {
      accessKind,
      editableRevisionId,
      readOnlyRevisionIds: [input.requestedRevisionId],
    };
  }

  const readOnlyRevisionIds: string[] = [];
  const pushVisible = (id: string | null) => {
    if (id && visible.has(id) && id !== editableRevisionId && !readOnlyRevisionIds.includes(id)) {
      readOnlyRevisionIds.push(id);
    }
  };

  if (accessKind === 'editor') {
    if (!editableRevisionId) pushVisible(input.currentId);
  } else if (accessKind === 'owner_viewer') {
    pushVisible(input.draftId);
    pushVisible(input.currentId);
  } else {
    pushVisible(input.currentId);
  }

  return { accessKind, editableRevisionId, readOnlyRevisionIds };
}
