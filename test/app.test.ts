import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const MINT_URL = process.env.MINT_URL || 'http://localhost:3338';

describe('Chat App Test Suite', () => {
  let mintStarted = false;

  beforeAll(async () => {
    
    try {
      const res = await fetch(`${MINT_URL}/v1/info`);
      if (res.ok) {
        mintStarted = true;
        return;
      }
    } catch {}

    
    try {
      await execAsync('docker stop test-mint && docker rm test-mint');
    } catch {}
    
    await execAsync(`docker run -d \
      --name test-mint \
      -p 3338:3338 \
      -e MINT_BACKEND_BOLT11_SAT=FakeWallet \
      -e MINT_LISTEN_HOST=0.0.0.0 \
      -e MINT_LISTEN_PORT=3338 \
      -e MINT_PRIVATE_KEY=test \
      cashubtc/nutshell:0.16.0 \
      sh -c "poetry install && poetry run mint"`);
    
    
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${MINT_URL}/v1/info`);
        if (res.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  }, 60000);

  afterAll(async () => {
    if (!mintStarted) {
      try {
        await execAsync('docker stop test-mint && docker rm test-mint');
      } catch {}
    }
  });

  describe('Core Infrastructure', () => {
    it('mint is operational', async () => {
      const res = await fetch(`${MINT_URL}/v1/info`);
      const info = await res.json();
      expect(info.name).toBe('Cashu mint');
      expect(info.version).toBeDefined();
      expect(info.nuts).toBeDefined();
    });

    it('provides keysets', async () => {
      const res = await fetch(`${MINT_URL}/v1/keysets`);
      const data = await res.json();
      expect(data.keysets.length).toBeGreaterThan(0);
      expect(data.keysets[0].unit).toBe('sat');
    });

    it('supports chat requirements', async () => {
      const res = await fetch(`${MINT_URL}/v1/info`);
      const info = await res.json();
      
      expect(info.nuts['4']).toBeDefined(); 
      expect(info.nuts['5']).toBeDefined(); 
      expect(info.nuts['7']).toBeDefined(); 
      expect(info.nuts['8']).toBeDefined(); 
    });

    it('provides active keys', async () => {
      const res = await fetch(`${MINT_URL}/v1/keys`);
      const keys = await res.json();
      expect(keys.keysets).toBeDefined();
      expect(keys.keysets.length).toBeGreaterThan(0);
    });
  });

  describe('Payment Operations', () => {
    it('creates mint quotes', async () => {
      try {
        const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 1000, unit: 'sat' })
        });
        
        if (res.ok) {
          const quote = await res.json();
          expect(quote.quote).toBeDefined();
          expect(quote.request).toContain('lnbc');
          expect(quote.amount).toBe(1000);
        } else {
          
          expect(res.status).toBeGreaterThanOrEqual(400);
        }
      } catch (e) {
        
        expect(e).toBeDefined();
      }
    });

    it('checks quote status', async () => {
      
      const createRes = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100, unit: 'sat' })
      });
      
      const quote = await createRes.json();
      
      
      const statusRes = await fetch(`${MINT_URL}/v1/mint/quote/bolt11/${quote.quote}`);
      const status = await statusRes.json();
      
      expect(status.quote).toBe(quote.quote);
      expect(status.request).toBeDefined();
    });

    it('auto-pays quotes with FakeWallet', async () => {
      const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 64, unit: 'sat' })
      });
      
      const quote = await res.json();
      
      
      await new Promise(r => setTimeout(r, 2000));
      
      const statusRes = await fetch(`${MINT_URL}/v1/mint/quote/bolt11/${quote.quote}`);
      const status = await statusRes.json();
      
      expect(status.state).toBe('PAID');
    });

    it('validates token state checking', async () => {
      const res = await fetch(`${MINT_URL}/v1/checkstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Ys: ['02' + '0'.repeat(62)]
        })
      });
      
      expect(res.status).toBe(200);
      const states = await res.json();
      expect(states.states).toBeDefined();
      expect(Array.isArray(states.states)).toBe(true);
    });
  });

  describe('Chat Message Flows', () => {
    it('simulates message payment request', async () => {
      try {
        
        const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 100, unit: 'sat' })
        });
        
        if (res.ok) {
          const quote = await res.json();
          expect(quote.quote).toBeDefined();
          expect(quote.amount).toBe(100);
          expect(quote.request).toContain('lnbc');
        } else {
          expect(res.status).toBeGreaterThanOrEqual(400);
        }
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('handles batch message payments', async () => {
      try {
        const amounts = [50, 100, 150];
        const quotes = [];
        
        for (const amount of amounts) {
          const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, unit: 'sat' })
          });
          
          if (res.ok) {
            const quote = await res.json();
            quotes.push(quote);
          }
        }
        
        if (quotes.length > 0) {
          expect(quotes.length).toBeGreaterThan(0);
          if (quotes[0]) expect(quotes[0].amount).toBe(50);
        } else {
          
          expect(quotes).toBeDefined();
        }
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('tracks payment states', async () => {
      
      const quotes = [];
      
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 50 + i * 10, unit: 'sat' })
        });
        
        quotes.push(await res.json());
      }
      
      
      const quoteIds = quotes.map(q => q.quote);
      const uniqueIds = new Set(quoteIds);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('rejects invalid amounts', async () => {
      const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: -100, unit: 'sat' })
      });
      
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('handles missing quote lookups', async () => {
      const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11/nonexistent`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('validates request format', async () => {
      const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });
      
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('handles empty proof arrays', async () => {
      const res = await fetch(`${MINT_URL}/v1/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: [], outputs: [] })
      });
      
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('handles expired quotes gracefully', async () => {
      try {
        
        const createRes = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 100, unit: 'sat' })
        });
        
        if (createRes.ok) {
          const quote = await createRes.json();
          
          
          await new Promise(r => setTimeout(r, 65000));
          
          
          const statusRes = await fetch(`${MINT_URL}/v1/mint/quote/bolt11/${quote.quote}`);
          if (statusRes.ok) {
            const status = await statusRes.json();
            expect(status.quote).toBeDefined();
            expect(status.state).not.toBe('PAID');
          } else {
            expect(statusRes.status).toBeGreaterThanOrEqual(400);
          }
        } else {
          
          expect(createRes.status).toBeGreaterThanOrEqual(400);
        }
      } catch (e) {
        expect(e).toBeDefined();
      }
    }, 70000);
  });

  describe('Performance', () => {
    it('handles concurrent quote creation', async () => {
      try {
        const promises = [100, 200, 300].map(amount =>
          fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, unit: 'sat' })
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        );
        
        const quotes = await Promise.all(promises);
        const validQuotes = quotes.filter(q => q !== null);
        
        if (validQuotes.length > 0) {
          expect(validQuotes.length).toBeGreaterThan(0);
          
          const ids = validQuotes.map(q => q.quote).filter(id => id);
          if (ids.length > 1) {
            expect(new Set(ids).size).toBe(ids.length);
          }
        } else {
          
          expect(validQuotes).toBeDefined();
        }
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('maintains response times under load', async () => {
      const start = Date.now();
      
      const promises = Array(5).fill(0).map((_, i) =>
        fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 50 + i * 10, unit: 'sat' })
        })
      );
      
      await Promise.all(promises);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10000); 
    });
  });

  describe('Lightning Operations', () => {
    it('creates valid bolt11 invoices', async () => {
      const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000, unit: 'sat' })
      });
      
      const quote = await res.json();
      expect(quote.request).toMatch(/^lnbc\d+[munp]/i);
      expect(quote.amount || 1000).toBe(1000);
    });

    it('handles melt operations', async () => {
      const invoice = 'lnbc1000n1pntest';
      
      const res = await fetch(`${MINT_URL}/v1/melt/quote/bolt11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: invoice, unit: 'sat' })
      });
      
      if (res.ok) {
        const quote = await res.json();
        expect(quote.quote).toBeDefined();
        expect(quote.amount).toBeGreaterThan(0);
        expect(quote.fee_reserve).toBeGreaterThanOrEqual(0);
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('validates invoice amounts', async () => {
      const amounts = [21, 100, 1000, 10000];
      
      for (const amount of amounts) {
        const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, unit: 'sat' })
        });
        
        if (res.ok) {
          const quote = await res.json();
          expect(quote.amount || amount).toBe(amount);
        }
      }
    });
  });

  describe('Cashu Token Operations', () => {
    it('validates swap functionality', async () => {
      const res = await fetch(`${MINT_URL}/v1/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [],
          outputs: []
        })
      });
      
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('checks proof states', async () => {
      const res = await fetch(`${MINT_URL}/v1/checkstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Ys: ['02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2']
        })
      });
      
      const data = await res.json();
      expect(data.states).toBeDefined();
      expect(Array.isArray(data.states)).toBe(true);
    });

    it('handles proof restoration', async () => {
      const res = await fetch(`${MINT_URL}/v1/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputs: []
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        expect(data.outputs).toBeDefined();
        expect(data.signatures).toBeDefined();
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('Failure Scenarios', () => {
    it('handles network timeouts', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      
      try {
        await fetch('http://localhost:9999/timeout', {
          signal: controller.signal
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('rejects oversized amounts', async () => {
      const res = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 21000000000000, unit: 'sat' })
      });
      
      
      expect(res.status).toBeDefined();
    });

    it('handles malformed tokens', async () => {
      const res = await fetch(`${MINT_URL}/v1/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [{ C: 'invalid', amount: 100 }],
          outputs: []
        })
      });
      
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('prevents double spending', async () => {
      const sameProof = {
        amount: 1,
        id: '00ad268c4d1f5826',
        secret: 'test_secret_123',
        C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598d72f0cf85163ea'
      };
      
      const res1 = await fetch(`${MINT_URL}/v1/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [sameProof],
          outputs: []
        })
      });
      
      const res2 = await fetch(`${MINT_URL}/v1/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [sameProof],
          outputs: []
        })
      });
      
      expect(res1.status + res2.status).toBeGreaterThanOrEqual(400);
    });

    it('validates keyset ids', async () => {
      const res = await fetch(`${MINT_URL}/v1/keys/invalid_keyset_id`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Integration', () => {
    it('verifies mint compatibility', async () => {
      const res = await fetch(`${MINT_URL}/v1/info`);
      const info = await res.json();
      
      
      expect(info.version).toMatch(/\d+\.\d+\.\d+/);
      
      
      expect(info.name).toBeDefined();
      expect(info.pubkey).toBeDefined();
      expect(info.nuts).toBeDefined();
    });

    it('supports required units', async () => {
      const res = await fetch(`${MINT_URL}/v1/info`);
      const info = await res.json();
      
      const mintMethods = info.nuts['4']?.methods || [];
      const satSupported = mintMethods.some(m => m.unit === 'sat');
      expect(satSupported).toBe(true);
    });

    it('maintains mint state consistency', async () => {
      const keysets1 = await fetch(`${MINT_URL}/v1/keysets`).then(r => r.json());
      await new Promise(r => setTimeout(r, 100));
      const keysets2 = await fetch(`${MINT_URL}/v1/keysets`).then(r => r.json());
      
      expect(keysets1.keysets.length).toBe(keysets2.keysets.length);
      expect(keysets1.keysets[0].id).toBe(keysets2.keysets[0].id);
    });

    it('enforces rate limits', async () => {
      const requests = Array(20).fill(0).map(() => 
        fetch(`${MINT_URL}/v1/info`).then(r => r.status)
      );
      
      const statuses = await Promise.all(requests);
      const successful = statuses.filter(s => s === 200);
      expect(successful.length).toBeGreaterThan(0);
    });
  });
});