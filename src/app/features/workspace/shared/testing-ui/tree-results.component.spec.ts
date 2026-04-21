import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TreeNode, TreeResultsComponent } from './tree-results.component';

describe('TreeResultsComponent', () => {
  let fixture: ComponentFixture<TreeResultsComponent>;
  let component: TreeResultsComponent;

  const tree: TreeNode[] = [
    {
      id: 'root',
      label: 'Suite',
      status: 'pass',
      children: [
        { id: 'c1', label: 'case-1', status: 'pass', meta: '12 ms' },
        { id: 'c2', label: 'case-2', status: 'fail' },
      ],
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TreeResultsComponent] }).compileComponents();
    fixture = TestBed.createComponent(TreeResultsComponent);
    component = fixture.componentInstance;
  });

  it('shows the empty placeholder when no nodes are given', () => {
    component.nodes = [];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tree-empty')).toBeTruthy();
  });

  it('expands every branch by default', () => {
    component.nodes = tree;
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.row');
    expect(rows.length).toBe(3);
  });

  it('collapses children when the parent caret is clicked', () => {
    component.nodes = tree;
    fixture.detectChanges();

    const rootBtn: HTMLButtonElement = fixture.debugElement
      .query(By.css('.row-btn.has-children')).nativeElement;
    rootBtn.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.row').length).toBe(1);
  });

  it('re-expands when clicked a second time', () => {
    component.nodes = tree;
    fixture.detectChanges();

    component.onClick(tree[0]); 
    component.onClick(tree[0]); 
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.row').length).toBe(3);
  });

  it('emits nodeClick with the clicked node for both leaves and branches', () => {
    component.nodes = tree;
    fixture.detectChanges();

    const emitted: TreeNode[] = [];
    component.nodeClick.subscribe((n) => emitted.push(n));

    component.onClick(tree[0]);                   
    component.onClick(tree[0].children![0]);      

    expect(emitted.length).toBe(2);
    expect(emitted[0].id).toBe('root');
    expect(emitted[1].id).toBe('c1');
  });

  it('respects defaultExpand=false by starting collapsed', () => {
    component.defaultExpand = false;
    component.nodes = tree;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.row').length).toBe(1);
  });

  it('applies the status-<value> class to each row', () => {
    component.nodes = tree;
    fixture.detectChanges();

    const firstRow = fixture.nativeElement.querySelector('.row')!;
    expect(firstRow.classList).toContain('status-pass');
  });

  it('renders meta text on the right of leaf rows', () => {
    component.nodes = tree;
    fixture.detectChanges();

    const meta = fixture.nativeElement.querySelector('.meta');
    expect(meta).toBeTruthy();
    expect(meta.textContent!.trim()).toBe('12 ms');
  });
});
