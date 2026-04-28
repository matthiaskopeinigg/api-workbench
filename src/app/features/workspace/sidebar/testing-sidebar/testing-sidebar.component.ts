import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { TabService } from '@core/tabs/tab.service';
import { TestsComponent } from '../tests/tests.component';
import { RegressionSidebarComponent } from '../regression-sidebar/regression-sidebar.component';

@Component({
  selector: 'app-testing-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, TestsComponent, RegressionSidebarComponent],
  templateUrl: './testing-sidebar.component.html',
  styleUrls: ['./testing-sidebar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestingSidebarComponent implements OnInit, OnDestroy {
  activeView: 'menu' | 'load-tests' | 'regressions' = 'menu';

  private destroy$ = new Subject<void>();

  constructor(
    private tabService: TabService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }


  openRegression(): void {
    this.activeView = 'regressions';
    this.cdr.markForCheck();
  }

  openSecurity(): void {
    this.tabService.openSecurityTab();
  }

  showLoadTests(): void {
    this.activeView = 'load-tests';
    this.cdr.markForCheck();
  }

  backToMenu(): void {
    this.activeView = 'menu';
    this.cdr.markForCheck();
  }
}
