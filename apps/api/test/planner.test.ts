import { describe, expect, it } from 'vitest';
import { mockAdjust, mockPlan } from '../src/planner/mock-planner';

describe('mock route planner', () => {
  it('plans six visits inside clinic hours, in time order', () => {
    const p = mockPlan('R001', '2026-10-31');
    expect(p.stops.length + p.unscheduled.length).toBe(6);
    for (const s of p.stops) {
      expect(s.arrive >= s.availStart!).toBe(true);
      expect(s.depart <= s.availEnd!).toBe(true);
    }
    expect(p.stops.map((s) => s.arrive)).toEqual([...p.stops.map((s) => s.arrive)].sort());
  });

  it('applies push, pin and reset', () => {
    const first = mockPlan('R002', '2026-11-02');
    const target = first.stops[first.stops.length - 1];
    const pinned = mockAdjust('R002', '2026-11-02', { action: 'PIN', hcpId: target.hcpId, param: '1' });
    expect(pinned.stops[0].hcpId).toBe(target.hcpId);
    const pushed = mockAdjust('R002', '2026-11-02', { action: 'PUSH', hcpId: target.hcpId });
    expect(pushed.stops.some((s) => s.hcpId === target.hcpId)).toBe(false);
    expect(mockPlan('R002', '2026-11-03').stops.concat(mockPlan('R002', '2026-11-03').unscheduled as never[]).some((s) => s.hcpId === target.hcpId)).toBe(true);
    expect(mockAdjust('R002', '2026-11-02', { action: 'RESET' }).stops.length).toBe(first.stops.length);
  });
});

describe('mock PIN', () => {
  it('moves a stop later without the greedy pass taking it first', () => {
    const first = mockPlan('R003', '2026-11-04');
    const second = first.stops[1];
    const moved = mockAdjust('R003', '2026-11-04', { action: 'PIN', hcpId: second.hcpId, param: '3' });
    expect(moved.stops[2]?.hcpId ?? moved.unscheduled.find((u) => u.hcpId === second.hcpId)?.hcpId).toBe(second.hcpId);
  });
});
