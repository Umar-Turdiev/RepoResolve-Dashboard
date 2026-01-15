import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import {
  trigger,
  transition,
  query,
  style,
  stagger,
  animate,
} from '@angular/animations';

import { ScanService, StartScanResponse } from '../../services/scan.service';
import type { SarifLog, SarifResult } from '../../models/sarif.model';
import { FindingsService } from '../../services/findings.service';
import {
  ApexChart,
  ApexAxisChartSeries,
  ApexDataLabels,
  ApexFill,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexResponsive,
  ApexStroke,
  ApexTheme,
  ApexXAxis,
  ApexYAxis,
  ApexGrid,
  ApexMarkers,
} from 'ng-apexcharts';

type Phase = 'idle' | 'starting' | 'scanning' | 'completed' | 'error';
type Sev = 'critical' | 'high' | 'medium' | 'low' | 'info';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  animations: [
    trigger('widgetsPopIn', [
      transition(':enter', [
        query(
          '.widget',
          [
            style({ transform: 'scale(0.94)', opacity: 0 }),
            stagger(
              120, // time gap between each
              animate(
                '500ms cubic-bezier(0.22, 1, 0.36, 1)',
                style({ transform: 'scale(1)', opacity: 1 })
              )
            ),
          ],
          { optional: true }
        ),
      ]),
    ]),
  ],
})
export class DashboardComponent {
  store = inject(FindingsService);

  // Semgrep-only for this widget (keep or swap to all-tools if you want)
  semgrep = computed(() => this.store.byTool('semgrep')());
  total = computed(() => this.semgrep().length);
  safetyScore = computed(() => this.store.safetyScore());
  aiSummary = computed(() => this.store.aiSummary());

  private order: Sev[] = ['critical', 'high', 'medium', 'low', 'info'];

  counts = computed(() => {
    const c: Record<Sev, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const f of this.semgrep()) {
      const s = String(f.severity || 'info').toLowerCase() as Sev;
      if (s in c) c[s]++;
      else c.info++;
    }
    // debug (call signals!)
    // console.log('total', this.total(), 'semgrep', this.semgrep());
    return c;
  });

  // Series/labels for the pie
  severitySeries = computed(() => this.order.map((s) => this.counts()[s]));
  severityLabels = this.order.map((s) => s[0].toUpperCase() + s.slice(1));

  chart: ApexChart = {
    type: 'pie',
    width: '100%',
    height: 300,
    sparkline: { enabled: true },
    background: 'transparent',
  };
  // Golden palette (darkest → lightest)
  colors = ['#023e8a', '#0077b6', '#0096c7', '#48cae4', '#90e0ef'];
  dataLabels = {
    enabled: false, // ⬅️ hide text labels on the chart itself
  };
  plotOptions = {
    pie: {
      // offsetY: 10,
      expandOnClick: false,
    },
  };
  legend: ApexLegend = {
    show: true,
    position: 'right', // ⬅️ show legend on right
    fontSize: '14px',
    horizontalAlign: 'center',
    height: 120,
    offsetY: -10,
    labels: {
      colors: '#ffffff', // text color
    },
    itemMargin: {
      vertical: 4,
    },
  };
  tooltip = {
    theme: 'dark',
    style: { fontSize: '14px', color: '#2b2b2b' },
    fillSeriesColor: false,
    marker: { show: false },
  };
  responsive: ApexResponsive[] = [
    {
      breakpoint: 640,
      options: {
        chart: { width: '100%' },
        legend: { position: 'bottom' },
      },
    },
  ];

  // === Single stacked bar (one compact line) ===
  barChart: ApexChart = {
    type: 'bar',
    height: 28,
    stacked: true,
    sparkline: { enabled: true }, // hides axes/grid
    animations: { enabled: false },
  };

  barColors = ['#023e8a', '#0077b6', '#0096c7', '#48cae4', '#90e0ef'];

  // make ONE category and MULTIPLE series (each series has one value)
  barSeries = computed(() => {
    const c = this.counts();
    return [
      { name: 'Critical', data: [c.critical] },
      { name: 'High', data: [c.high] },
      { name: 'Medium', data: [c.medium] },
      { name: 'Low', data: [c.low] },
      { name: 'Info', data: [c.info] },
    ];
  });

  barPlot: ApexPlotOptions = {
    bar: {
      horizontal: true,
      distributed: false, // must be false for stacking
      barHeight: '100%',
      borderRadius: 10,
    },
  };

  barFill: ApexFill = { opacity: 1, colors: this.barColors };
  barStroke: ApexStroke = { width: 0 };
  barTooltip = {
    enabled: true,
    theme: 'dark', // looks consistent with your UI
    x: {
      show: false,
    },
    y: {
      formatter: (val: number, opts: any) => {
        return `${val} issues`; // e.g. "High: 3 issues"
      },
    },
    style: {
      fontSize: '14px',
      color: '#2b2b2b',
    },
  };
  // hide axes completely (we only want the line)
  barXaxis = {
    categories: ['All Severities'],
    labels: { show: false },
    axisTicks: { show: false },
    axisBorder: { show: false },
  };
  barYaxis = { show: false };
  barLegend = { show: false }; // we already have the legend next to the pie

  // === SAFETY SCORE TREND (weekly) ===
  safetySeries = computed<ApexAxisChartSeries>(() => {
    const base = [4, 6, 5, 7, 6, 8, 0];
    const score = this.safetyScore();
    if (score != null && Number.isFinite(score)) {
      base[6] = Math.min(10, Math.max(0, score)); // Friday
    }
    return [
      {
        name: 'Safety Score',
        data: base,
      },
    ];
  });

  safetyChart: ApexChart = {
    type: 'area',
    height: 220,
    background: 'transparent',
    toolbar: { show: false },
    animations: { enabled: true },
  };

  safetyStroke: ApexStroke = {
    curve: 'smooth',
    width: 3,
    colors: ['#36abffff'],
  };

  safetyFill: ApexFill = {
    type: 'gradient',
    colors: ['#36abffff'],
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.4,
      opacityTo: 0.05,
      stops: [0, 90, 100],
    },
  };

  safetyDataLabels: ApexDataLabels = { enabled: false };

  safetyMarkers: ApexMarkers = {
    size: 0,
    hover: { size: 4 },
  };

  safetyXaxis: ApexXAxis = {
    categories: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    labels: {
      style: {
        colors: '#ffffffff',
        fontSize: '14px',
      },
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  };

  safetyYaxis: ApexYAxis = {
    min: 0,
    max: 10,
    tickAmount: 5,
    labels: {
      offsetX: -15,
      style: {
        colors: ['#ffffffff'],
        fontSize: '14px',
      },
    },
  };

  safetyGrid: ApexGrid = {
    borderColor: '#676767ff',
    strokeDashArray: 5,
    padding: {},
  };

  safetyTooltip = {
    enabled: true,
    theme: 'dark',
    y: {
      formatter: (val: number) => `${val.toFixed(1)}`,
      title: {
        formatter: () => 'Safety Score',
      },
    },
  };

  // === SAFETY SCORE RADIAL (gradient ring) ===
  safetyRadialSeries = computed<ApexNonAxisChartSeries>(() => {
    const score = this.safetyScore();
    if (score == null || Number.isNaN(score)) return [0];
    return [Math.min(100, Math.max(0, score * 10))];
  });

  safetyRadialChart: ApexChart = {
    type: 'radialBar',
    background: 'transparent',
    toolbar: { show: false },
    height: 220,
    width: 220,
  };

  safetyRadialPlot: ApexPlotOptions = {
    radialBar: {
      startAngle: -120,
      endAngle: 90,
      hollow: {
        margin: 0,
        size: '70%',
        background: 'transparent',
        position: 'front',
      },
      track: {
        background: 'transparent',
        strokeWidth: '67%',
        margin: 0,
      },
      dataLabels: {
        show: true,
        name: {
          offsetY: -30,
          show: true,
          color: '#c8c8c8ff',
          fontSize: '14px',
          fontWeight: 300,
        },
        value: {
          offsetY: -3,
          formatter: (val: number) =>
            (Math.round((val / 10) * 10) / 10).toString(),
          color: '#ffffffff',
          fontSize: '45px',
          fontWeight: 700,
          show: true,
        },
      },
    },
  };

  safetyRadialFill: ApexFill = {
    colors: ['#00ffffff'],
    type: 'gradient',
    gradient: {
      shade: 'dark',
      type: 'diagonal1',
      shadeIntensity: 1,
      gradientToColors: ['#b0e5a7'],
      inverseColors: true,
      opacityFrom: 1,
      opacityTo: 1,
      stops: [0, 100],
    },
  };

  safetyRadialStroke: ApexStroke = {
    lineCap: 'round',
  };

  safetyRadialLabels = ['Safety'];
}
