import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class WindowService {

  minimize(): void {
    window.awElectron.minimizeWindow();
  }

  maximize(): void {
    window.awElectron.maximizeWindow();
  }

  close(): void {
    window.awElectron.closeWindow();
  }

}


