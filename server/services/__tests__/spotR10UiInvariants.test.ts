/**
 * R10 Tests — UI invariants: Nav, MobileTabBar, App routes, REAL button.
 *
 * Source-inspection tests that verify:
 *   1. Nav.tsx does NOT contain TRADING or TERMINAL links
 *   2. Nav.tsx contains SPOT link
 *   3. MobileTabBar.tsx has /spot tab (not /trading)
 *   4. App.tsx redirects /trading → /spot
 *   5. App.tsx redirects /terminal → /spot
 *   6. SpotStatusPanel.tsx supports REAL mode with confirmation modal
 *   7. Spot.tsx has Activity tab
 *   8. Spot.tsx mode mutation accepts REAL
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const CLIENT_ROOT = path.resolve(__dirname, "../../../client/src");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(CLIENT_ROOT, rel), "utf-8");
}

describe("R10: UI Invariants", () => {
  describe("Nav.tsx", () => {
    const navContent = readFile("components/dashboard/Nav.tsx");

    it("R10-TU1: should NOT contain TRADING nav link", () => {
      expect(navContent).not.toMatch(/href:\s*["']\/trading["']/);
    });

    it("R10-TU2: should NOT contain TERMINAL nav link", () => {
      expect(navContent).not.toMatch(/href:\s*["']\/terminal["']/);
    });

    it("R10-TU3: should contain SPOT nav link", () => {
      expect(navContent).toMatch(/href:\s*["']\/spot["']/);
    });
  });

  describe("MobileTabBar.tsx", () => {
    const mobileContent = readFile("components/mobile/MobileTabBar.tsx");

    it("R10-TU4: should have /spot tab (not /trading)", () => {
      expect(mobileContent).toMatch(/href:\s*["']\/spot["']/);
      expect(mobileContent).not.toMatch(/href:\s*["']\/trading["']/);
    });

    it("R10-TU5: should include /trading in aliases for /spot", () => {
      expect(mobileContent).toMatch(/aliases.*\/trading/);
    });
  });

  describe("App.tsx", () => {
    const appContent = readFile("App.tsx");

    it("R10-TU6: should redirect /trading to /spot", () => {
      expect(appContent).toMatch(/path=["']\/trading["']/);
      expect(appContent).toMatch(/Redirect.*to=["']\/spot["']/);
    });

    it("R10-TU7: should redirect /terminal to /spot", () => {
      expect(appContent).toMatch(/path=["']\/terminal["']/);
      // The terminal redirect should go to /spot
      const terminalLine = appContent.match(/path=["']\/terminal["'].*?/);
      expect(terminalLine).not.toBeNull();
    });

    it("R10-TU8: should have /spot route with Spot component", () => {
      expect(appContent).toMatch(/path=["']\/spot["'].*component=\{Spot\}/);
    });
  });

  describe("SpotStatusPanel.tsx", () => {
    const panelContent = readFile("components/spot/SpotStatusPanel.tsx");

    it("R10-TU9: should support REAL mode in onModeChange type", () => {
      expect(panelContent).toMatch(/"OFF"\s*\|\s*"SHADOW"\s*\|\s*"REAL"/);
    });

    it("R10-TU10: should have REAL confirmation modal", () => {
      expect(panelContent).toMatch(/showRealConfirm/);
      expect(panelContent).toMatch(/Confirmar REAL/);
    });

    it("R10-TU11: should fetch /api/spot/real-readiness", () => {
      expect(panelContent).toMatch(/\/api\/spot\/real-readiness/);
    });

    it("R10-TU12: should have ReadinessCheck component", () => {
      expect(panelContent).toMatch(/ReadinessCheck/);
    });
  });

  describe("Spot.tsx", () => {
    const spotContent = readFile("pages/Spot.tsx");

    it("R10-TU13: should have Activity tab", () => {
      expect(spotContent).toMatch(/value=["']activity["']/);
    });

    it("R10-TU14: mode mutation should accept REAL", () => {
      expect(spotContent).toMatch(/"OFF"\s*\|\s*"SHADOW"\s*\|\s*"REAL"/);
    });

    it("R10-TU15: should fetch /api/spot/activity", () => {
      expect(spotContent).toMatch(/\/api\/spot\/activity/);
    });

    it("R10-TU16: should have SpotActivityPanel component", () => {
      expect(spotContent).toMatch(/SpotActivityPanel/);
    });
  });
});
