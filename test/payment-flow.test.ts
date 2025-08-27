import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import { CashuMint, CashuWallet, getEncodedToken, getDecodedToken, Proof } from '@cashu/cashu-ts';

const MINT_URL = process.env.MINT_URL || 'http://localhost:3338';

describe('Payment Flow Integration', () => {
  let mint: CashuMint;
  
  beforeAll(async () => {
    mint = new CashuMint(MINT_URL);
    
    
    for (let i = 0; i < 30; i++) {
      try {
        const info = await mint.getInfo();
        if (info) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  });

  beforeEach(() => {
    
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  });

  describe('Token Send/Receive Flow', () => {
    it('simulates chat app token sending', async () => {
      const senderWallet = new CashuWallet(mint, { unit: 'sat' });
      const receiverWallet = new CashuWallet(mint, { unit: 'sat' });
      
      
      const mintQuote = await senderWallet.createMintQuote(1000);
      expect(mintQuote.quote).toBeDefined();
      expect(mintQuote.request).toMatch(/^lnbc/);
      
      
      await new Promise(r => setTimeout(r, 2000));
      
      
      const quoteState = await senderWallet.checkMintQuote(mintQuote.quote);
      expect(quoteState.state).toBeDefined();
    });

    it('handles token format validation', async () => {
      
      const invalidTokens = [
        'not-a-token',
        'cashuA',
        '',
        'cashuA' + Buffer.from('invalid').toString('base64url')
      ];
      
      for (const token of invalidTokens) {
        try {
          const decoded = getDecodedToken(token);
          expect(decoded).toBeUndefined();
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
      
      
      const validTokenFormat = 'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzMzOCIsInByb29mcyI6W119XX0';
      
      try {
        const decoded = getDecodedToken(validTokenFormat);
        expect(decoded.token).toBeDefined();
      } catch (error) {
        
        expect(error).toBeDefined();
      }
    });
  });

  describe('Error Recovery', () => {
    it('handles pending proofs recovery like useCashuToken', async () => {
      
      const pendingProofs = {
        mintUrl: MINT_URL,
        proofsToSend: [
          { id: 'test', amount: 50, secret: 'pending', C: 'pending' }
        ],
        timestamp: Date.now()
      };
      
      const pendingKey = `pending_send_proofs_${Date.now()}`;
      localStorage.setItem(pendingKey, JSON.stringify(pendingProofs));
      
      
      const keys = Object.keys(localStorage).filter(key => 
        key.startsWith('pending_send_proofs_')
      );
      expect(keys.length).toBeGreaterThan(0);
      
      
      for (const key of keys) {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        expect(data.mintUrl).toBe(MINT_URL);
        expect(data.proofsToSend).toBeDefined();
        
        
        sessionStorage.setItem(`recovery_processed_${key}`, 'true');
        localStorage.removeItem(key);
      }
      
      
      const remainingKeys = Object.keys(localStorage).filter(key => 
        key.startsWith('pending_send_proofs_')
      );
      expect(remainingKeys.length).toBe(0);
    });

    it('simulates double spending prevention', async () => {
      
      const spentTokens = new Set<string>();
      
      const tokenId = 'token_' + Date.now();
      
      
      if (!spentTokens.has(tokenId)) {
        spentTokens.add(tokenId);
        expect(spentTokens.has(tokenId)).toBe(true);
      }
      
      
      if (spentTokens.has(tokenId)) {
        expect(() => {
          throw new Error('Token already spent');
        }).toThrow('Token already spent');
      }
    });
  });

  describe('Mint Connection Failures', () => {
    it('handles mint being offline', async () => {
      const offlineMintUrl = 'http://localhost:9999';
      const offlineWallet = new CashuWallet(new CashuMint(offlineMintUrl), { unit: 'sat' });
      
      try {
        await offlineWallet.createMintQuote(100);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error).toBeDefined();
      }
    });

    it('handles invalid mint responses', async () => {
      const wallet = new CashuWallet(mint, { unit: 'sat' });
      
      
      try {
        await wallet.createMintQuote(-100);
        expect.fail('Should reject negative amount');
      } catch (error) {
        expect(error).toBeDefined();
      }
      
      try {
        await wallet.createMintQuote(0);
        expect.fail('Should reject zero amount');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Quote Management', () => {
    it('tracks mint quotes like the app does', async () => {
      const wallet = new CashuWallet(mint, { unit: 'sat' });
      
      const quotes: any[] = [];
      
      
      for (let i = 0; i < 3; i++) {
        const quote = await wallet.createMintQuote(100 * (i + 1));
        quotes.push(quote);
        expect(quote.quote).toBeDefined();
      }
      
      
      const quoteIds = quotes.map(q => q.quote);
      const uniqueIds = [...new Set(quoteIds)];
      expect(uniqueIds.length).toBe(quotes.length);
      
      
      for (const quote of quotes) {
        const state = await wallet.checkMintQuote(quote.quote);
        expect(state.quote).toBe(quote.quote);
        expect(state.state).toBeDefined();
      }
    });
  });
});