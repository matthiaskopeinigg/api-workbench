import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SettingsComponent } from './settings/settings.component';
import { CommonModule } from '@angular/common';
import { WindowService } from '@core/window.service';
import { CookieManagerComponent } from '../shared/cookie-manager/cookie-manager.component';

@Component({
  selector: 'app-titlebar',
  imports: [
    SettingsComponent,
    CommonModule,
    CookieManagerComponent
  ],
  templateUrl: './titlebar.component.html',
  styleUrl: './titlebar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitlebarComponent {

  showSettings = false;
  showCookieManager = false;

  toggleSettingsPopup() {
    this.showSettings = !this.showSettings;
  }

  constructor(private windowService: WindowService) {
  }

  minimize() {
    this.windowService.minimize();
  }

  maximize() {
    this.windowService.maximize();
  }

  close() {
    this.windowService.close();
  }
}


