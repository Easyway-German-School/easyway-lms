const PAST_ENROLMENT_YEARS = 6;
const FUTURE_ENROLMENT_YEARS = 5;

/** Calendar years offered by the student roster's enrolment-year filter. */
export function enrolmentYearOptions(now: Date = new Date()): number[] {
  const currentYear = now.getFullYear();
  const years: number[] = [];

  for (let year = currentYear + FUTURE_ENROLMENT_YEARS; year >= currentYear - PAST_ENROLMENT_YEARS; year -= 1) {
    years.push(year);
  }

  return years;
}
