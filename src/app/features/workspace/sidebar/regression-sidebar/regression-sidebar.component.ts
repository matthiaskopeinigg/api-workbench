import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RegressionTestingService } from '../../tab/regression/regression.service';
import { TabService } from '@core/tabs/tab.service';

@Component({
  selector: 'app-regression-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './regression-sidebar.component.html',
  styleUrl: './regression-sidebar.component.scss'
})
export class RegressionSidebarComponent {
  private readonly svc = inject(RegressionTestingService);
  private readonly tabSvc = inject(TabService);

  readonly projects = this.svc.projects;
  readonly runs = this.svc.runs;

  createRelease() {
    this.tabSvc.openRegressionTab('reg:new-release', 'New Release');
  }

  openProject(id: string, name: string) {
    this.tabSvc.openRegressionTab(`reg:p:${id}`, name);
  }

  openFlow(id: string, name: string) {
    this.tabSvc.openRegressionTab(`reg:f:${id}`, name);
  }

  openRun(id: string, tag: string) {
    this.tabSvc.openRegressionTab(`reg:r:${id}`, `Run: ${tag}`);
  }
}
