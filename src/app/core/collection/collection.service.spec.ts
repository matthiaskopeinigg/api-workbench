import { TestBed } from '@angular/core/testing';
import { CollectionService, MIXED_LEAF_ORDER_APPEND_SENTINEL } from './collection.service';
import type { Collection, Folder } from '@models/collection';
import { AuthType, HttpMethod } from '@models/request';

describe('CollectionService (WebSocket entries)', () => {
  let service: CollectionService;
  let saveCollectionsSpy: jasmine.Spy;

  const wsA = {
    id: 'ws-a',
    title: 'Sock A',
    mode: 'ws' as const,
    url: 'wss://a.example',
    protocols: [],
    headers: [],
    auth: { type: AuthType.NONE },
  };

  beforeEach(() => {
    saveCollectionsSpy = jasmine.createSpy('saveCollections').and.returnValue(Promise.resolve());
    (window as any).awElectron = {
      getCollections: jasmine.createSpy('getCollections').and.returnValue(
        Promise.resolve([
          {
            id: 'root',
            order: 0,
            title: 'Root',
            requests: [],
            websocketRequests: [wsA],
            folders: [
              {
                id: 'f1',
                order: 0,
                title: 'F1',
                requests: [],
                websocketRequests: [
                  {
                    id: 'ws-b',
                    title: 'B',
                    mode: 'sse' as const,
                    url: 'https://b.example',
                    auth: { type: AuthType.BEARER, bearer: { token: 't' } },
                  },
                ],
                folders: [],
              },
            ],
          },
        ]),
      ),
      saveCollections: saveCollectionsSpy,
    };

    TestBed.configureTestingModule({
      providers: [CollectionService],
    });
    service = TestBed.inject(CollectionService);
  });

  it('indexes websocket entries for findWebSocketRequestById', async () => {
    await service.loadCollections();
    expect(service.findWebSocketRequestById('ws-a')).toEqual(jasmine.objectContaining({ id: 'ws-a' }));
    expect(service.findWebSocketRequestById('ws-b')?.mode).toBe('sse');
    expect(service.findWebSocketRequestById('missing')).toBeNull();
  });

  it('moveWebSocketRequest moves an entry between folder and collection root', async () => {
    await service.loadCollections();
    await service.moveWebSocketRequest('ws-b', 'root', true);
    const root = service.getCollections()[0] as Collection;
    const f1 = root.folders[0] as Folder;
    expect((f1.websocketRequests || []).some((w) => w.id === 'ws-b')).toBeFalse();
    expect((root.websocketRequests || []).some((w) => w.id === 'ws-b')).toBeTrue();
  });

  it('updateWebSocketRequest mutates the indexed entry', async () => {
    await service.loadCollections();
    const ok = service.updateWebSocketRequest({ ...wsA, title: 'Renamed' });
    expect(ok).toBeTrue();
    expect(service.findWebSocketRequestById('ws-a')?.title).toBe('Renamed');
  });
});

describe('CollectionService (moveRequestBeforeInParent / moveWebSocketBeforeInParent)', () => {
  let service: CollectionService;
  let saveCollectionsSpy: jasmine.Spy;

  const r = (id: string) =>
    ({
      id,
      title: id,
      httpMethod: HttpMethod.GET,
      url: `https://${id}.example`,
      headers: [],
    }) as any;

  beforeEach(() => {
    saveCollectionsSpy = jasmine.createSpy('saveCollections').and.returnValue(Promise.resolve());
    (window as any).awElectron = {
      getCollections: jasmine.createSpy('getCollections').and.returnValue(
        Promise.resolve([
          {
            id: 'root',
            order: 0,
            title: 'Root',
            requests: [r('r1'), r('r2'), r('r3')],
            websocketRequests: [
              { id: 'w1', title: 'W1', mode: 'ws' as const, url: 'wss://1', protocols: [], headers: [], auth: { type: AuthType.NONE } },
              { id: 'w2', title: 'W2', mode: 'ws' as const, url: 'wss://2', protocols: [], headers: [], auth: { type: AuthType.NONE } },
            ],
            folders: [
              {
                id: 'f1',
                order: 0,
                title: 'F1',
                requests: [r('r4')],
                websocketRequests: [{ id: 'w3', title: 'W3', mode: 'ws' as const, url: 'wss://3', protocols: [], headers: [], auth: { type: AuthType.NONE } }],
                folders: [],
              },
            ],
          },
        ]),
      ),
      saveCollections: saveCollectionsSpy,
    };

    TestBed.configureTestingModule({
      providers: [CollectionService],
    });
    service = TestBed.inject(CollectionService);
  });

  it('moveRequestBeforeInParent reorders within the collection root', async () => {
    await service.loadCollections();
    await service.moveRequestBeforeInParent('r3', 'root', true, 'r1');
    const root = service.getCollections()[0] as Collection;
    expect(root.requests.map((x) => x.id)).toEqual(['r3', 'r1', 'r2']);
  });

  it('moveWebSocketBeforeInParent reorders within the collection root', async () => {
    await service.loadCollections();
    await service.moveWebSocketBeforeInParent('w2', 'root', true, 'w1');
    const root = service.getCollections()[0] as Collection;
    expect((root.websocketRequests || []).map((x) => x.id)).toEqual(['w2', 'w1']);
  });

  it('moveRequestBeforeInParent moves a request from root into a folder before an existing row', async () => {
    await service.loadCollections();
    await service.moveRequestBeforeInParent('r2', 'f1', false, 'r4');
    const root = service.getCollections()[0] as Collection;
    const f1 = root.folders[0] as Folder;
    expect(root.requests.map((x) => x.id)).toEqual(['r1', 'r3']);
    expect(f1.requests.map((x) => x.id)).toEqual(['r2', 'r4']);
  });

  it('moveRequestOrWebSocketBeforeInMixedOrder places a WebSocket before the first request', async () => {
    await service.loadCollections();
    await service.moveRequestOrWebSocketBeforeInMixedOrder('w2', true, 'root', true, 'r1', false);
    const root = service.getCollections()[0] as Collection;
    const merged = service.buildMergedRequestWebSocketLeaves(root);
    expect(merged.map((l) => (l.isWs ? 'w:' : 'r:') + l.item.id)).toEqual(['w:w2', 'r:r1', 'r:r2', 'r:r3', 'w:w1']);
  });

  it('moveRequestOrWebSocketBeforeInMixedOrder with append sentinel moves a request to the end of the leaf list', async () => {
    await service.loadCollections();
    await service.moveRequestOrWebSocketBeforeInMixedOrder(
      'r1',
      false,
      'root',
      true,
      MIXED_LEAF_ORDER_APPEND_SENTINEL,
      false,
    );
    const root = service.getCollections()[0] as Collection;
    const merged = service.buildMergedRequestWebSocketLeaves(root);
    expect(merged.map((l) => (l.isWs ? 'w:' : 'r:') + l.item.id)).toEqual(['r:r2', 'r:r3', 'w:w1', 'w:w2', 'r:r1']);
  });
});
