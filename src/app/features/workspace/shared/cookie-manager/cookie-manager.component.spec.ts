import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { CookieManagerComponent } from './cookie-manager.component';
import { CookieService } from '@core/http/cookie.service';

describe('CookieManagerComponent', () => {
  let component: CookieManagerComponent;
  let fixture: ComponentFixture<CookieManagerComponent>;
  let cookieServiceSpy: jasmine.SpyObj<CookieService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  const mockCookies = [
    { key: 'session', value: 'abc', domain: 'example.com', path: '/' },
    { key: 'token', value: 'xyz', domain: 'example.com', path: '/' },
    { key: 'tracker', value: '42', domain: 'ads.net', path: '/' }
  ];

  beforeEach(async () => {
    cookieServiceSpy = jasmine.createSpyObj('CookieService', [
      'getAllCookies',
      'deleteCookie',
      'clearAllCookies'
    ]);
    cookieServiceSpy.getAllCookies.and.returnValue(Promise.resolve([...mockCookies]));
    cookieServiceSpy.deleteCookie.and.returnValue(Promise.resolve());
    cookieServiceSpy.clearAllCookies.and.returnValue(Promise.resolve());

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm', 'alert']);
    confirmDialogSpy.confirm.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [CookieManagerComponent],
      providers: [
        { provide: CookieService, useValue: cookieServiceSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CookieManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create and load cookies on init', () => {
    expect(component).toBeTruthy();
    expect(cookieServiceSpy.getAllCookies).toHaveBeenCalled();
    expect(component.cookies.length).toBe(3);
  });

  it('filteredGroups should group cookies by domain and sort alphabetically', () => {
    const groups = component.filteredGroups;
    expect(groups.map(g => g.domain)).toEqual(['ads.net', 'example.com']);
    expect(groups[1].cookies.length).toBe(2);
  });

  it('filteredGroups should narrow results by searchTerm against domain or cookie name', () => {
    component.searchTerm = 'token';
    const groups = component.filteredGroups;
    expect(groups.length).toBe(1);
    expect(groups[0].cookies[0].key).toBe('token');
  });

  it('deleteCookie should call the service and refresh the list', async () => {
    await component.deleteCookie(mockCookies[0]);

    expect(cookieServiceSpy.deleteCookie).toHaveBeenCalledWith('example.com', '/', 'session');
    expect(cookieServiceSpy.getAllCookies.calls.count()).toBe(2);
  });

  it('clearAll should confirm before clearing', async () => {
    confirmDialogSpy.confirm.and.resolveTo(false);
    await component.clearAll();
    expect(cookieServiceSpy.clearAllCookies).not.toHaveBeenCalled();

    confirmDialogSpy.confirm.and.resolveTo(true);
    await component.clearAll();
    expect(cookieServiceSpy.clearAllCookies).toHaveBeenCalled();
  });

  it('close EventEmitter should fire when close() is called externally', () => {
    const spy = jasmine.createSpy('close');
    component.close.subscribe(spy);
    component.close.emit();
    expect(spy).toHaveBeenCalled();
  });
});
