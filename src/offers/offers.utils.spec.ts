import { describe, expect, it } from 'vitest';
import { defaultScore, discountPercentage, haversineKm, sortOffers } from './offers.utils.js';

describe('offer utils', () => {
  describe('discountPercentage', () => {
    it('computes the rounded sale percentage when originalPrice is set', () => {
      expect(discountPercentage({ price: 1500, originalPrice: 2000 })).toBe(25);
    });

    it('returns null without a usable originalPrice', () => {
      expect(discountPercentage({ price: 1500, originalPrice: null })).toBeNull();
      expect(discountPercentage({ price: 1500, originalPrice: 0 })).toBeNull();
    });
  });

  describe('haversineKm', () => {
    it('returns 0 for identical points', () => {
      expect(haversineKm(-18.9, 47.5, -18.9, 47.5)).toBe(0);
    });

    it('matches the known Paris–Lyon distance (~392 km)', () => {
      const distance = haversineKm(48.8566, 2.3522, 45.764, 4.8357);
      expect(distance).toBeGreaterThan(385);
      expect(distance).toBeLessThan(400);
    });
  });

  describe('sortOffers / defaultScore', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    const offer = (
      id: string,
      expirationDate: string,
      creatorCancellationCount = 0,
      distanceKm?: number,
    ) => ({
      id,
      expirationDate: new Date(expirationDate),
      distanceKm,
      creator: { creatorCancellationCount },
    });

    it('sorts by ascending DLC with sortBy=dlc', () => {
      const offers = [
        offer('far', '2026-11-25T00:00:00.000Z'),
        offer('near', '2026-11-24T00:00:00.000Z'),
      ];

      const sorted = sortOffers(offers, 'dlc', undefined, undefined, now);

      expect(sorted.map((o) => o.id)).toEqual(['near', 'far']);
    });

    it('penalizes sellers with a high creatorCancellationCount in default sort', () => {
      // Le vendeur annulateur a une DLC plus proche, mais la pénalité doit le reléguer
      const offers = [
        offer('cancelled', '2026-11-24T00:00:00.000Z', 6),
        offer('clean', '2026-11-26T00:00:00.000Z', 0),
      ];

      const sorted = sortOffers(offers, 'default', undefined, undefined, now);

      expect(sorted.map((o) => o.id)).toEqual(['clean', 'cancelled']);
    });

    it('ranks a nearer offer first in default sort when both sellers are clean', () => {
      const offers = [
        offer('distant', '2026-11-24T00:00:00.000Z', 0, 10),
        offer('close', '2026-11-24T06:00:00.000Z', 0, 1),
      ];

      const sorted = sortOffers(offers, 'default', -18.9, 47.5, now);

      expect(sorted.map((o) => o.id)).toEqual(['close', 'distant']);
    });

    it('defaultScore drops when the seller cancels often', () => {
      const clean = defaultScore(
        { expirationDate: now, creator: { creatorCancellationCount: 0 } },
        undefined,
        undefined,
        now,
      );
      const cancelled = defaultScore(
        { expirationDate: now, creator: { creatorCancellationCount: 4 } },
        undefined,
        undefined,
        now,
      );

      expect(cancelled).toBeLessThan(clean);
    });
  });
});
