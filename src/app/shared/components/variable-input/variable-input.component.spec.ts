import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VariableInputComponent } from './variable-input.component';

describe('VariableInputComponent', () => {
  let component: VariableInputComponent;
  let fixture: ComponentFixture<VariableInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VariableInputComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(VariableInputComponent);
    component = fixture.componentInstance;
    component.activeVariables = { base_url: 'example.com', token: 'abc-123' };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('writeValue should store value and trigger parsing into parsedParts', () => {
    component.writeValue('hello {{base_url}} world');

    expect(component.value).toBe('hello {{base_url}} world');
    expect(component.parsedParts.length).toBe(3);
    expect(component.parsedParts[0]).toEqual({ text: 'hello ', isVariable: false });
    expect(component.parsedParts[1].text).toBe('{{base_url}}');
    expect(component.parsedParts[1].isVariable).toBeTrue();
    expect(component.parsedParts[1].value).toBe('example.com');
    expect(component.parsedParts[1].isPathVar).toBeFalse();
  });

  it('should flag unknown {{vars}} as non-matching (isVariable=false)', () => {
    component.writeValue('{{unknown}}');
    const varPart = component.parsedParts.find(p => p.text === '{{unknown}}');
    expect(varPart).toBeDefined();
    expect(varPart!.isVariable).toBeFalse();
  });

  it('should detect :pathVariable segments and mark them as path variables', () => {
    component.enablePathParamHighlight = true;
    component.writeValue('/users/:id/posts');

    const pathVar = component.parsedParts.find(p => p.isPathVar);
    expect(pathVar).toBeDefined();
    expect(pathVar!.text).toBe(':id');
    expect(pathVar!.isVariable).toBeTrue();
  });

  it('should not style :word as a path param when path highlighting is off (default)', () => {
    component.writeValue('key:value');
    expect(component.parsedParts.find((p) => p.isPathVar)).toBeUndefined();
  });

  it('should highlight dynamic $uuid like env vars', () => {
    component.writeValue('x-$uuid');
    const dyn = component.parsedParts.find(p => p.text === '$uuid');
    expect(dyn).toBeDefined();
    expect(dyn!.isVariable).toBeTrue();
    expect(dyn!.isDynamic).toBeTrue();
    expect(dyn!.dynamicName).toBe('uuid');
    const tip = component.getTooltip(dyn!);
    expect(tip).toContain('random UUID');
  });

  it('should treat {{$uuid}} as dynamic when not set in env', () => {
    component.writeValue('p-{{$uuid}}');
    const dyn = component.parsedParts.find(p => p.text === '{{$uuid}}');
    expect(dyn).toBeDefined();
    expect(dyn!.isDynamic).toBeTrue();
  });

  it('onInput should update value, emit registered onChange, and re-parse', () => {
    const changeSpy = jasmine.createSpy('onChange');
    component.registerOnChange(changeSpy);

    component.onInput({ target: { value: '{{token}}' } });

    expect(component.value).toBe('{{token}}');
    expect(changeSpy).toHaveBeenCalledWith('{{token}}');
    expect(component.parsedParts[0].value).toBe('abc-123');
  });

  it('getTooltip should return null for literal parts and a formatted string for variables', () => {
    expect(component.getTooltip({ text: 'plain', isVariable: false })).toBeNull();

    const tip = component.getTooltip({ text: 'base_url', isVariable: true, value: 'example.com' });
    expect(tip).toContain('Variable: <strong>base_url</strong>');
    expect(tip).toContain('example.com');
  });

  it('getTooltip should render undefined value placeholder', () => {
    const tip = component.getTooltip({ text: 'missing', isVariable: true });
    expect(tip).toContain('undefined');
  });

  it('getTooltip should show (empty) for defined empty string', () => {
    const tip = component.getTooltip({ text: '{{x}}', isVariable: true, value: '' });
    expect(tip).toContain('(empty)');
  });

  it('should highlight known env var with empty value', () => {
    component.activeVariables = { base_url: '' };
    component.writeValue('{{base_url}}');
    const p = component.parsedParts.find((x) => x.text === '{{base_url}}');
    expect(p).toBeDefined();
    expect(p!.isVariable).toBeTrue();
    expect(p!.value).toBe('');
  });

  it('updateSuggestFromInput should offer env keys after {{', () => {
    const input = {
      getBoundingClientRect: () =>
        ({ bottom: 0, left: 0, width: 100, top: 0, right: 100 } as DOMRect),
    } as HTMLInputElement;
    component.value = '{{to';
    (component as any).updateSuggestFromInput(input, 4);
    expect(component.suggestOpen).toBeTrue();
    expect(component.suggestList.length).toBe(1);
    expect(component.suggestList[0].name).toBe('token');
  });

  it('clearHover should reset hoveredValue', () => {
    (component as any).hoveredValue = {} as any;
    component.clearHover();
    expect(component.hoveredValue).toBeNull();
  });

  it('ngOnChanges should re-parse when activeVariables reference changes', () => {
    component.writeValue('{{token}}');
    expect(component.parsedParts[0].value).toBe('abc-123');

    component.activeVariables = { token: 'xyz-789' };
    component.ngOnChanges();

    expect(component.parsedParts[0].value).toBe('xyz-789');
  });

  it('setDisabledState should flip disabled flag', () => {
    component.setDisabledState(true);
    expect(component.disabled).toBeTrue();
    component.setDisabledState(false);
    expect(component.disabled).toBeFalse();
  });
});
