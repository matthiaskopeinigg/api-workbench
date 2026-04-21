import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JsonEditorComponent } from './json-editor.component';

describe('JsonEditorComponent', () => {
  let component: JsonEditorComponent;
  let fixture: ComponentFixture<JsonEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JsonEditorComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(JsonEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create with json-editor defaults', () => {
    expect(component).toBeTruthy();
    expect(component.editorType).toBe('json');
    expect(component.readonly).toBeFalse();
    expect(component.minHeight).toBe(60);
    expect(component.maxHeight).toBe(500);
  });

  it('should forward min/max height styles to the wrapper', () => {
    component.minHeight = 120;
    component.maxHeight = 400;
    fixture.detectChanges();

    const wrap: HTMLElement = fixture.nativeElement.querySelector('.wrap');
    expect(wrap.style.minHeight).toBe('120px');
    expect(wrap.style.maxHeight).toBe('400px');
  });

  it('jsonChange should re-emit the child editor contentChange stream', () => {
    const spy = jasmine.createSpy('jsonChange');
    component.jsonChange.subscribe(spy);

    component.jsonChange.emit('{"foo":1}');

    expect(spy).toHaveBeenCalledWith('{"foo":1}');
  });
});
