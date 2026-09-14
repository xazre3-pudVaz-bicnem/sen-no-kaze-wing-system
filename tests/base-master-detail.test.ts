import { describe, expect, it } from 'vitest';
import { resolveBaseMasterDetailView } from '@/lib/domain/base-master-detail';

describe('本体マスター詳細の参照表示', () => {
  const draftId = '11111111-1111-4111-8111-111111111111';
  const currentId = '22222222-2222-4222-8222-222222222222';
  const oldId = '33333333-3333-4333-8333-333333333333';

  it('editorはDraftを編集し、公開版を重複表示しない', () => {
    expect(resolveBaseMasterDetailView({
      canEdit: true,
      canViewOwned: true,
      draftId,
      currentId,
      visibleRevisionIds: [draftId, currentId, oldId],
    })).toEqual({
      accessKind: 'editor',
      editableRevisionId: draftId,
      readOnlyRevisionIds: [],
    });
  });

  it('所有組織viewerはDraftと現在公開版を参照できる', () => {
    expect(resolveBaseMasterDetailView({
      canEdit: false,
      canViewOwned: true,
      draftId,
      currentId,
      visibleRevisionIds: [draftId, currentId, oldId],
    })).toEqual({
      accessKind: 'owner_viewer',
      editableRevisionId: null,
      readOnlyRevisionIds: [draftId, currentId],
    });
  });

  it('共有先ユーザーにはDraftを見せず現在公開版だけ表示する', () => {
    expect(resolveBaseMasterDetailView({
      canEdit: false,
      canViewOwned: false,
      draftId,
      currentId,
      visibleRevisionIds: [currentId, oldId],
    })).toEqual({
      accessKind: 'shared_viewer',
      editableRevisionId: null,
      readOnlyRevisionIds: [currentId],
    });
  });

  it('所有組織viewerは履歴から旧版明細を選べる', () => {
    expect(resolveBaseMasterDetailView({
      canEdit: false,
      canViewOwned: true,
      draftId,
      currentId,
      requestedRevisionId: oldId,
      visibleRevisionIds: [draftId, currentId, oldId],
    })).toEqual({
      accessKind: 'owner_viewer',
      editableRevisionId: null,
      readOnlyRevisionIds: [oldId],
    });
  });

  it('RLSで見えないRevision IDをURL指定しても表示対象にしない', () => {
    expect(resolveBaseMasterDetailView({
      canEdit: false,
      canViewOwned: false,
      draftId,
      currentId,
      requestedRevisionId: draftId,
      visibleRevisionIds: [currentId, oldId],
    })).toEqual({
      accessKind: 'shared_viewer',
      editableRevisionId: null,
      readOnlyRevisionIds: [currentId],
    });
  });

  it('Draftがなければeditorにも公開版を参照表示する', () => {
    expect(resolveBaseMasterDetailView({
      canEdit: true,
      canViewOwned: true,
      draftId: null,
      currentId,
      visibleRevisionIds: [currentId, oldId],
    })).toEqual({
      accessKind: 'editor',
      editableRevisionId: null,
      readOnlyRevisionIds: [currentId],
    });
  });
});
