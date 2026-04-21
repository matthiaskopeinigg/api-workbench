import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { v4 as uuidv4 } from 'uuid';
import { Environment } from '@models/environment';
import { EnvironmentsService } from '@core/environments.service';
import { TabItem, TabService, TabType } from '@core/tab.service';
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

  private dragIndex: number | null = null;
  private dragOverIndex: number | null = null;

  private destroy$ = new Subject<void>();

  constructor(private environmentsService: EnvironmentsService,
    private tabService: TabService,
    private cdr: ChangeDetectorRef) { }

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

  
  async deleteEnvironment(index: number) {
    const removed = this.environments[index];

    this.environments.splice(index, 1);

    this.recalculateOrder();
    await this.saveEnvironments();

    if (this.selectedEnv?.id === removed.id) {
      this.selectedEnv = null;
    }
  }

  
  async selectEnvironment(env: Environment) {
    if (this.dragIndex) {
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
    const inputContainer = document.querySelector('.input-group');

    if (inputContainer && !inputContainer.contains(target)) {

      this.newEnvTitle = '';
    }
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

