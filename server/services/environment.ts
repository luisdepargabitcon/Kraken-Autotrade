import { randomUUID } from "crypto";
import { hostname } from "os";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

type EnvTag = "REPLIT/DEV" | "VPS/STG" | "NAS/PROD";

function getPackageVersion(): string {
  try {
    const pkgPath = join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

class EnvironmentService {
  private _envTag: EnvTag;
  private _instanceId: string;
  private _version: string;
  private _isReplit: boolean;
  private _isVPS: boolean;
  private _isNAS: boolean;
  private _panelUrl: string;

  constructor() {
    this._version = `${getPackageVersion()}-${getGitCommit()}`;
    this._isReplit = !!(process.env.REPLIT_DEPLOYMENT || process.env.REPL_ID);
    this._isVPS = !!process.env.VPS_DEPLOY;
    this._isNAS = !this._isReplit && !this._isVPS;
    
    if (this._isReplit) {
      this._envTag = "REPLIT/DEV";
    } else if (this._isVPS) {
      this._envTag = "VPS/STG";
    } else {
      this._envTag = "NAS/PROD";
    }
    
    this._instanceId = `${hostname().slice(0, 12)}-${process.pid}`;
    this._panelUrl = process.env.PANEL_URL || 
      (this._isReplit ? `https://${process.env.REPLIT_DEV_DOMAIN || 'panel.replit.app'}` : 
       this._isVPS ? process.env.VPS_PANEL_URL || "http://localhost:3020" :
       process.env.NAS_PANEL_URL || "http://localhost:5000");
  }

  get envTag(): EnvTag {
    return this._envTag;
  }

  get instanceId(): string {
    return this._instanceId;
  }

  get version(): string {
    return this._version;
  }

  get isReplit(): boolean {
    return this._isReplit;
  }

  get isVPS(): boolean {
    return this._isVPS;
  }

  get isNAS(): boolean {
    return this._isNAS;
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

  getInfo(): { env: EnvTag; instanceId: string; version: string; isReplit: boolean; isVPS: boolean; isNAS: boolean; panelUrl: string } {
    return {
      env: this._envTag,
      instanceId: this._instanceId,
      version: this._version,
      isReplit: this._isReplit,
      isVPS: this._isVPS,
      isNAS: this._isNAS,
      panelUrl: this._panelUrl,
    };
  }
}

export const environment = new EnvironmentService();
