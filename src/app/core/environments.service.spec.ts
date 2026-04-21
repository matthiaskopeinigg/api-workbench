import { TestBed } from '@angular/core/testing';
import { EnvironmentsService } from './environments.service';
import { SessionService } from './session.service';
import { Environment } from '@models/environment';

describe('EnvironmentsService Integration', () => {
    let service: EnvironmentsService;
    let sessionServiceSpy: jasmine.SpyObj<SessionService>;

    const mockEnvironments: Environment[] = [
        { id: 'env-1', title: 'Development', variables: [{ key: 'url', value: 'dev.com' }], order: 0 },
        { id: 'env-2', title: 'Production', variables: [{ key: 'url', value: 'prod.com' }], order: 1 }
    ];

    let originalAwElectron: any;

    beforeEach(() => {
        const spy = jasmine.createSpyObj('SessionService', ['save', 'load', 'get']);
        originalAwElectron = (window as any).awElectron;
        (window as any).awElectron = jasmine.createSpyObj('awElectron', ['getEnvironments', 'saveEnvironments', 'getSession', 'saveSession']);

        TestBed.configureTestingModule({
            providers: [
                EnvironmentsService,
                { provide: SessionService, useValue: spy }
            ]
        });

        service = TestBed.inject(EnvironmentsService);
        sessionServiceSpy = TestBed.inject(SessionService) as jasmine.SpyObj<SessionService>;
    });

    afterEach(() => {
        (window as any).awElectron = originalAwElectron;
    });

    it('should load environments and restore active context from session', async () => {
        (window.awElectron.getEnvironments as jasmine.Spy).and.returnValue(Promise.resolve(mockEnvironments));
        sessionServiceSpy.get.and.returnValue('env-2');

        await service.loadEnvironments();

        expect(service.getEnvironments()).toEqual(mockEnvironments);
        expect(service.getActiveContext()?.id).toBe('env-2');
        expect(sessionServiceSpy.load).toHaveBeenCalledWith('activeEnvironmentId');
    });

    it('should persist active environment change to session', async () => {
        const env = mockEnvironments[0];
        await service.setActiveContext(env);

        expect(service.getActiveContext()).toBe(env);
        expect(sessionServiceSpy.save).toHaveBeenCalledWith('activeEnvironmentId', env.id);
    });

    it('should update specific environment and notify observers', async () => {
        service['environmentsSubject'].next(mockEnvironments); 
        service['rebuildIndex']();

        (window.awElectron.saveEnvironments as jasmine.Spy).and.returnValue(Promise.resolve());

        const updatedEnv = { ...mockEnvironments[0], title: 'Dev-Updated' };
        await service.saveEnvironment(updatedEnv);
        await service.flushPendingSaves();

        expect(window.awElectron.saveEnvironments).toHaveBeenCalled();
        const envs = service.getEnvironments();
        expect(envs.find(e => e.id === 'env-1')?.title).toBe('Dev-Updated');
    });
});
