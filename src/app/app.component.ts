import { Component, computed, inject, signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ScanService } from './services/scan.service';
import { trigger, transition, style, animate } from '@angular/animations';
import { FindingsService } from './services/findings.service';
import { HarnessFinding, VantaFinding } from './models/finding.model';

import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  animations: [
    trigger('slideDown', [
      transition(':enter', [
        style({ transform: 'translateY(-50px)', opacity: 0 }),
        animate(
          '1.5s cubic-bezier(0.22, 1, 0.36, 1)',
          style({ transform: 'translateY(0)', opacity: 1 })
        ),
      ]),
    ]),
    // Chat panel pops in on enter
    trigger('popIn', [
      transition(':enter', [
        style({ transform: 'scale(0.96)', opacity: 0 }),
        animate(
          '2s cubic-bezier(0.22, 1, 0.36, 1)',
          style({ transform: 'scale(1)', opacity: 1 })
        ),
      ]),
    ]),
  ],
})
export class AppComponent {
  private scan = inject(ScanService);
  private findings = inject(FindingsService);
  private router = inject(Router);

  private currentUrl = signal(this.router.url);
  showChat = computed(() => this.currentUrl().startsWith('/vulnerabilities'));

  hasSession = computed(
    () => !!environment.devConfigs.skipStartScreen || !!this.scan.scanSession()
  );

  constructor() {
    this.findings.initDevMockIfEnabled(); // 👈 seeds fake data for UI

    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentUrl.set((e as NavigationEnd).urlAfterRedirects);
      });
  }
}
