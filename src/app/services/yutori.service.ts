import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

type YutoriParams = {
  task: string;
  start_url: string;
};

type YutoriScoutParams = {
  query: string;
};

@Injectable({ providedIn: 'root' })
export class YutoriService {
  async runTask(params: YutoriParams): Promise<any> {
    const res = await fetch(environment.yutori.tasksUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': environment.yutori.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Yutori error ${res.status}`);
    }

    return res.json();
  }

  async getTask(taskId: string): Promise<any> {
    const url = `${environment.yutori.taskStatusBaseUrl}/${taskId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': environment.yutori.apiKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Yutori error ${res.status}`);
    }

    return res.json();
  }

  async runScoutTask(params: YutoriScoutParams): Promise<any> {
    const res = await fetch(environment.yutori.scoutingTasksUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': environment.yutori.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Yutori error ${res.status}`);
    }

    return res.json();
  }

  async getScoutUpdates(taskId: string, pageSize = 20): Promise<any> {
    const params = new URLSearchParams({ page_size: String(pageSize) });
    const url = `${environment.yutori.scoutingUpdatesBaseUrl}/${taskId}/updates?${params}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': environment.yutori.apiKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 && text.includes('No updates found')) {
        return { updates: [] };
      }
      throw new Error(text || `Yutori error ${res.status}`);
    }

    return res.json();
  }

  async getScoutTask(taskId: string): Promise<any> {
    const url = `${environment.yutori.scoutingUpdatesBaseUrl}/${taskId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': environment.yutori.apiKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Yutori error ${res.status}`);
    }

    return res.json();
  }
}
