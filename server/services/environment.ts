import { randomUUID } from "crypto";
import { hostname } from "os";

type EnvTag = "REPLIT/DEV" | "NAS/PROD";

class EnvironmentService {
  private _envTag: EnvTag;
  private _instanceId: string;
  private _isReplit: boolean;
  private _panelUrl: string;

  constructor() {
    this._isReplit = !!(process.env.REPLIT_DEPLOYMENT || process.env.REPL_ID);
    this._envTag = this._isReplit ? "REPLIT/DEV" : "NAS/PROD";
    this._instanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
    this._panelUrl = process.env.PANEL_URL || 
      (this._isReplit ? `https://${process.env.REPLIT_DEV_DOMAIN || 'panel.replit.app'}` : 
       process.env.NAS_PANEL_URL || "http://localhost:5000");
  }

  get envTag(): EnvTag {
    return this._envTag;
  }

  get instanceId(): string {
    return this._instanceId;
  }

  get isReplit(): boolean {
    return this._isReplit;
  }

  get isNAS(): boolean {
    return !this._isReplit;
  }

  get panelUrl(): string {
    return this._panelUrl;
  }

  getMessagePrefix(dryRun: boolean): string {
    if (this._isReplit || dryRun) {
      return `[${this._envTag}][DRY_RUN] `;
    }
    return `[${this._envTag}] `;
  }

  getInfo(): { env: EnvTag; instanceId: string; isReplit: boolean; isNAS: boolean; panelUrl: string } {
    return {
      env: this._envTag,
      instanceId: this._instanceId,
      isReplit: this._isReplit,
      isNAS: !this._isReplit,
      panelUrl: this._panelUrl,
    };
  }
}

export const environment = new EnvironmentService();
