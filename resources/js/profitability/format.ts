import dayjs from 'dayjs';
import { formatNumber } from '@/packages/ui/src/utils/number';

// Number formats of the profitability module (UI-SPEC UI-D1). Hours are decimal hours (budgets are
// sold and planned in whole and half hours), never the hh:mm reporting format.

const EN_DASH = '–';
const MINUS = '−';

/**
 * Decimal hours with at most one decimal and the trailing ".0" dropped, grouped with the
 * organization number format, suffix " h": 45000 -> "12.5 h", 4464000 (comma-point) -> "1,240 h".
 * Callers pass a magnitude; negative hours are written as words in the copy (":n h over").
 */
export function formatHours(seconds: number, numberFormat?: string | null): string {
    return `${formatHoursNumber(seconds, numberFormat)} h`;
}

/** The bare number of formatHours, for copy that adds the "h" itself (the `:n` placeholder). */
export function formatHoursNumber(seconds: number, numberFormat?: string | null): string {
    const hours = Math.round(seconds / 360) / 10;
    const formatted = formatNumber(hours, numberFormat ?? undefined);
    // A known number format always writes two decimals: keep one, drop it when it is 0.
    const match = /^(.*)([.,])(\d)(\d)$/.exec(formatted);
    if (!match) return formatted;
    const [, whole, separator, tenths] = match;
    return tenths === '0' ? (whole as string) : `${whole}${separator}${tenths}`;
}

/** Integer percent of a ratio: 0.684 -> "68 %". */
export function formatPercent(ratio: number): string {
    return `${Math.round(ratio * 100)} %`;
}

/** Signed percentage points with a real minus: -7 -> "−7 pp", 3 -> "+3 pp". */
export function formatPp(points: number): string {
    const rounded = Math.round(points);
    if (rounded === 0) return '0 pp';
    return rounded < 0 ? `${MINUS}${Math.abs(rounded)} pp` : `+${rounded} pp`;
}

// Calendar dates ("YYYY-MM-DD") are parsed as local dates so no time zone can move them a day.
function day(isoDate: string): dayjs.Dayjs {
    return dayjs(isoDate.slice(0, 10));
}

/** "2026-11-01" -> "Nov 2026". */
export function formatMonth(isoDate: string): string {
    return day(isoDate).format('MMM YYYY');
}

/**
 * A period label per UI-D1: whole months "Nov 2026", "Oct – Dec 2026", "Dec 2026 – Feb 2027";
 * part months "15 – 30 Nov 2026", "15 Oct – 30 Nov 2026", "15 Nov 2026 – 31 Mar 2027".
 */
export function formatPeriod(startsOn: string, endsOn: string): string {
    const start = day(startsOn);
    const end = day(endsOn);
    const sameYear = start.year() === end.year();
    const sameMonth = sameYear && start.month() === end.month();

    const wholeMonths = start.date() === 1 && end.date() === end.daysInMonth();
    if (wholeMonths) {
        if (sameMonth) return start.format('MMM YYYY');
        if (sameYear) return `${start.format('MMM')} ${EN_DASH} ${end.format('MMM YYYY')}`;
        return `${start.format('MMM YYYY')} ${EN_DASH} ${end.format('MMM YYYY')}`;
    }

    if (start.isSame(end, 'day')) return start.format('D MMM YYYY');
    if (sameMonth) return `${start.format('D')} ${EN_DASH} ${end.format('D MMM YYYY')}`;
    if (sameYear) return `${start.format('D MMM')} ${EN_DASH} ${end.format('D MMM YYYY')}`;
    return `${start.format('D MMM YYYY')} ${EN_DASH} ${end.format('D MMM YYYY')}`;
}

/**
 * Fills `:key` placeholders of a server label (copy stays server-side). An unknown placeholder
 * stays as written; a longer token is never read as a shorter one (`:soldier` is not `:sold`).
 */
export function fill(template: string, params: Record<string, string | number> = {}): string {
    return template.replace(/:([a-z_]+)/gi, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    );
}
