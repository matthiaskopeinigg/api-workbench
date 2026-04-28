import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { v4 as uuidv4 } from 'uuid';
import { Environment } from '@models/environment';
import { EnvironmentsService } from '@core/environments/environments.service';
import { TabItem, TabService, TabType } from '@core/tabs/tab.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-environment',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './environment.component.html',
  styleUrls: ['./environment.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EnvironmentComponent implements OnInit, OnDestroy {

  environments: Environment[] = [];
  selectedEnv: Environment | null = null;

  newEnvTitle = '';

  /** Inline rename in the list (double-click title or context menu). */
  editingEnvironmentId: string | null = null;

  contextMenuVisible = false;
  contextMenuEnv: Environment | null = null;
  menuX = 0;
  menuY = 0;

  private dragIndex: number | null = null;
  private dragOverIndex: number | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private environmentsService: EnvironmentsService,
    private tabService: TabService,
    private cdr: ChangeDetectorRef,
    private confirmDialog: ConfirmDialogService,
  ) {}

  async ngOnInit() {
    this.environmentsService.getEnvironmentsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(envs => {
        this.environments = [...(envs ?? [])].sort((a, b) => a.order - b.order);
        this.cdr.markForCheck();
      });

    await this.loadSelectedEnvironment();
    await this.loadListeners();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadSelectedEnvironment() {
    const selectedTab = this.tabService.getSelectedTab();
    if (!selectedTab || !this.tabService.isEnvironmentTab(selectedTab)) {
      return;
    }

    const selectedEnvironment = this.environmentsService.getEnvironmentById(selectedTab.id);
    if (selectedEnvironment) {
      await this.selectEnvironment(selectedEnvironment);
    }
  }

  private async loadListeners() {
    this.environmentsService.getSelectedEnvironmentAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(selectedTab => {
        if (!selectedTab) {
          this.selectedEnv = null;
          this.cdr.markForCheck();
          return;
        }

        const selectedEnvironment = this.environmentsService.getEnvironmentById(selectedTab.id);
        if (selectedEnvironment) {
          this.selectedEnv = selectedEnvironment;
          this.cdr.markForCheck();
        }
      });
  }

  trackById(index: number, item: any): string {
    return item.id;
  }

  
  async addEnvironment() {
    const title = this.newEnvTitle.trim();
    if (!title) return;

    const newEnv: Environment = {
      id: uuidv4(),
      title,
      order: this.environments.length, 
      variables: []
    };

    this.environments.push(newEnv);

    await this.saveEnvironments();

    this.newEnvTitle = '';
    this.selectEnvironment(newEnv);
  }

  
  openContextMenu(event: MouseEvent, env: Environment): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuEnv = env;
    this.contextMenuVisible = true;
    const pad = 8;
    const mw = 200;
    const mh = 44;
    let x = event.clientX;
    let y = event.clientY;
    if (typeof window !== 'undefined') {
      x = Math.min(x, window.innerWidth - mw - pad);
      y = Math.min(y, window.innerHeight - mh - pad);
      x = Math.max(pad, x);
      y = Math.max(pad, y);
    }
    this.menuX = x;
    this.menuY = y;
    this.cdr.markForCheck();
  }

  closeContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextMenuEnv = null;
    this.cdr.markForCheck();
  }

  async deleteEnvironmentFromContext(): Promise<void> {
    const env = this.contextMenuEnv;
    this.closeContextMenu();
    if (!env) {
      return;
    }
    const ok = await this.confirmDialog.confirm({
      title: 'Delete environment',
      message: `Delete "${env.title}"? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) {
      return;
    }
    const index = this.environments.findIndex((e) => e.id === env.id);
    if (index >= 0) {
      await this.deleteEnvironment(index);
    }
  }

  async deleteEnvironment(index: number) {
    const removed = this.environments[index];

    this.environments.splice(index, 1);

    this.recalculateOrder();
    await this.saveEnvironments();

    if (this.selectedEnv?.id === removed.id) {
      this.selectedEnv = null;
    }
    this.environmentsService.triggerEnvironmentDeleted(removed.id);
  }

  
  async selectEnvironment(env: Environment) {
    if (this.dragIndex != null) {
      this.dragIndex = null;
    }

    this.selectedEnv = env;
    const tabItem: TabItem = {
      id: env.id,
      title: env.title,
      type: TabType.ENVIRONMENT
    };

    await this.environmentsService.selectEnvironment(tabItem);
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    const target = event.target as HTMLElement;
    const editingId = this.editingEnvironmentId;
    if (editingId) {
      const renameInput = document.querySelector<HTMLInputElement>(`input#environment-${editingId}`);
      if (renameInput && !renameInput.contains(target)) {
        const env = this.environments.find((e) => e.id === editingId);
        if (env) {
          void this.finishRenameEnvironment(env, renameInput.value);
        }
      }
    }

    this.closeContextMenu();
    const inputContainer = document.querySelector('.input-group');

    if (inputContainer && !inputContainer.contains(target)) {

      this.newEnvTitle = '';
    }
  }

  startRenameEnvironment(envId: string): void {
    this.closeContextMenu();
    this.editingEnvironmentId = envId;
    this.cdr.markForCheck();
  }

  cancelRenameEnvironment(): void {
    this.editingEnvironmentId = null;
    this.cdr.markForCheck();
  }

  async finishRenameEnvironment(env: Environment, raw: string): Promise<void> {
    if (this.editingEnvironmentId !== env.id) {
      return;
    }
    this.editingEnvironmentId = null;
    const trimmed = (raw ?? '').trim();
    const nextTitle = trimmed || env.title;
    if (nextTitle === env.title) {
      this.cdr.markForCheck();
      return;
    }
    env.title = nextTitle;
    await this.saveEnvironments();
    this.environmentsService.emitEnvironmentTitleUpdated(env.id, env.title);
    this.cdr.markForCheck();
  }

  
  onNewEnvInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.newEnvTitle = input.value;
  }

  
  onDragStart(index: number) {
    this.dragIndex = index;
  }

  onDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    this.dragOverIndex = index;
  }

  async onDrop() {
    if (this.dragIndex === null || this.dragOverIndex === null) return;

    const item = this.environments[this.dragIndex];

    this.environments.splice(this.dragIndex, 1);
    this.environments.splice(this.dragOverIndex, 0, item);

    this.recalculateOrder();
    await this.saveEnvironments();

    this.dragIndex = null;
    this.dragOverIndex = null;
  }

  isDragOver(index: number) {
    return this.dragOverIndex === index;
  }

  
  private recalculateOrder() {
    this.environments.forEach((env, i) => env.order = i);
  }

  
  private async saveEnvironments() {
    const sorted = [...this.environments].sort((a, b) => a.order - b.order);
    await this.environmentsService.saveEnvironments(sorted);
  }
}

