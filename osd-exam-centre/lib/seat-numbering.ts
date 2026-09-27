/**
 * Seat numbers, in the exact scheme the school actually uses on the day:
 * block 1 counts DOWN from 50 to 1, block 2 counts down from 100 to 51,
 * block 3 from 150 to 101, and so on — matching how the physical rooms are
 * numbered, not a plain ascending counter.
 *
 * `takenIndex` is 0-based: the first CONFIRMED seat in a session is index 0.
 * Seats are assigned at payment-verification time (see lib/booking.ts,
 * confirmBooking), not at raw booking time — a candidate who never pays never
 * occupies a seat number, matching "your seat is automatically reserved"
 * being a post-payment message, not a post-booking one.
 */

const BLOCK_SIZE = 50;

export function seatNumberForIndex(takenIndex: number, blockSize = BLOCK_SIZE): number {
  const blockIndex = Math.floor(takenIndex / blockSize);
  const positionInBlock = takenIndex % blockSize;
  const blockCeiling = (blockIndex + 1) * blockSize;
  return blockCeiling - positionInBlock;
}
