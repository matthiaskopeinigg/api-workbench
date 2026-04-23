import { registerLocaleData } from '@angular/common';
import localeEn from '@angular/common/locales/en';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

registerLocaleData(localeEn, 'en-US');

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
