import { Router } from 'express';
import { storage } from '../storage';
import { botLogger } from '../services/botLogger';

const router = Router();

// POST /api/admin/backfill-legacy-positions
router.post('/backfill-legacy-positions', async (req, res) => {
  try {
    console.log('[BACKFILL] Starting legacy positions backfill...');
    
    // Step 1: Find positions without AEP data
    const legacyPositions = await storage.getLegacyPositionsNeedingBackfill();
    console.log(`[BACKFILL] Found ${legacyPositions.length} legacy positions to backfill`);
    
    let backfilledCount = 0;
    let importedCount = 0;
    
    for (const position of legacyPositions) {
      // Find matching trades for this position
      const matchingTrades = await storage.findTradesForPositionBackfill(position);
      
      if (matchingTrades.length > 0) {
        // Calculate aggregates from trades
        const totalCostQuote = matchingTrades.reduce((sum, trade) => 
          sum + (parseFloat(trade.price) * parseFloat(trade.amount)), 0);
        const totalAmountBase = matchingTrades.reduce((sum, trade) => 
          sum + parseFloat(trade.amount), 0);
        const averageEntryPrice = totalAmountBase > 0 ? totalCostQuote / totalAmountBase : null;
        
        // Update position with AEP data
        await storage.updatePositionWithBackfill(position.id, {
          totalCostQuote,
          totalAmountBase,
          averageEntryPrice,
          fillCount: matchingTrades.length,
          firstFillAt: new Date(Math.min(...matchingTrades.map(t => new Date(t.executed_at).getTime()))),
          lastFillAt: new Date(Math.max(...matchingTrades.map(t => new Date(t.executed_at).getTime()))),
          entryPrice: averageEntryPrice
        });
        
        backfilledCount++;
        console.log(`[BACKFILL] Backfilled position ${position.pair}: avgPrice=${averageEntryPrice}, fills=${matchingTrades.length}`);
      } else {
        // Mark as IMPORTED if no trades found
        await storage.updatePositionAsImported(position.id);
        importedCount++;
        console.log(`[BACKFILL] Marked position ${position.pair} as IMPORTED (no matching trades)`);
      }
    }
    
    const result = {
      success: true,
      summary: {
        legacyPositionsFound: legacyPositions.length,
        positionsBackfilled: backfilledCount,
        positionsMarkedImported: importedCount,
        timestamp: new Date().toISOString()
      }
    };
    
    await botLogger.info("BACKFILL_COMPLETED", "Legacy positions backfill completed", result.summary);
    
    res.json(result);
  } catch (error: any) {
    console.error('[BACKFILL] Error:', error);
    await botLogger.error("BACKFILL_ERROR", "Legacy positions backfill failed", { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET /api/admin/backfill-status
router.get('/backfill-status', async (req, res) => {
  try {
    const status = await storage.getBackfillStatus();
    res.json(status);
  } catch (error: any) {
    console.error('[BACKFILL] Status error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
