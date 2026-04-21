import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { SettingsService } from './settings.service';
import { Theme } from '@models/settings';

describe('ThemeService Integration', () => {
    let service: ThemeService;
    let settingsServiceSpy: jasmine.SpyObj<SettingsService>;

    beforeEach(() => {
        const spy = jasmine.createSpyObj('SettingsService', ['loadSettings', 'getSettings', 'saveSettings']);

        TestBed.configureTestingModule({
            providers: [
                ThemeService,
                { provide: SettingsService, useValue: spy }
            ]
        });

        service = TestBed.inject(ThemeService);
        settingsServiceSpy = TestBed.inject(SettingsService) as jasmine.SpyObj<SettingsService>;

        settingsServiceSpy.getSettings.and.returnValue({ ui: { theme: Theme.LIGHT } } as any);
    });

    it('should load theme from settings and apply to body', async () => {
        settingsServiceSpy.getSettings.and.returnValue({ ui: { theme: Theme.DARK } } as any);

        await service.loadTheme();

        expect(settingsServiceSpy.loadSettings).toHaveBeenCalled();
        expect(service.getTheme()).toBe(Theme.DARK);
        expect(document.body.classList).toContain('theme-dark');
    });

    it('should persist theme change to settings', async () => {
        await service.setTheme(Theme.DRACULA);

        expect(service.getTheme()).toBe(Theme.DRACULA);
        expect(document.body.classList).toContain('theme-dracula');
        expect(settingsServiceSpy.saveSettings).toHaveBeenCalledWith(jasmine.objectContaining({
            ui: jasmine.objectContaining({ theme: Theme.DRACULA })
        }));
    });

    it('should notify observers of theme changes', (done) => {
        service.getThemeSubject().subscribe(theme => {
            if (theme === Theme.MONOKAI) {
                expect(theme).toBe(Theme.MONOKAI);
                done();
            }
        });

        service.setTheme(Theme.MONOKAI);
    });

    it('should set data-theme system and apply ayu palette when theme is SYSTEM', async () => {
        spyOn(window, 'matchMedia').and.returnValue({
            matches: true,
            addEventListener: jasmine.createSpy('add'),
            removeEventListener: jasmine.createSpy('remove'),
        } as unknown as MediaQueryList);

        await service.setTheme(Theme.SYSTEM, false);

        expect(service.getTheme()).toBe(Theme.SYSTEM);
        expect(document.documentElement.getAttribute('data-theme')).toBe('system');
        expect(document.body.classList).toContain('theme-ayu-dark');
    });
});
