package com.mine.focus;

import java.util.List;

/**
 * 倒数日天数。和 countdown-days.js 用同一套规则：
 * 不重复走公历日期差（含非法日期进位，和 JS Date / daysUntil 一致）；
 * repeat=yearly 取下一次公历月日，2 月 29 在平年落到 2 月 28；
 * lunar + yearly 取下一次农历月日（没有这个闰月的年份跳过，月不够长就用当月最后一天）。
 */
public final class CountdownDays {
    // LUNAR_INFO_BEGIN
    static final int[] LUNAR_INFO = {
        0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
        0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
        0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
        0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
        0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
        0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
        0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
        0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
        0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
        0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
        0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
        0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
        0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
        0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
        0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
        0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
        0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
        0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
        0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
        0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
        0x0d520
    };
    // LUNAR_INFO_END

    private CountdownDays() {}

    public static final class Spec {
        public final String id;
        public final String title;
        public final String date;
        public final boolean yearly;
        public final boolean lunar;
        public final int lunarMonth;
        public final int lunarDay;
        public final boolean lunarLeap;

        public Spec(String id, String title, String date, boolean yearly, boolean lunar, int lunarMonth, int lunarDay, boolean lunarLeap) {
            this.id = id == null ? "" : id;
            this.title = title == null ? "" : title;
            this.date = date == null ? "" : date;
            this.yearly = yearly;
            this.lunar = lunar;
            this.lunarMonth = lunarMonth;
            this.lunarDay = lunarDay;
            this.lunarLeap = lunarLeap;
        }
    }

    public static final class LunarDate {
        public final int year;
        public final int month;
        public final int day;
        public final boolean leap;

        LunarDate(int year, int month, int day, boolean leap) {
            this.year = year;
            this.month = month;
            this.day = day;
            this.leap = leap;
        }
    }

    public static final class Copy {
        public final String number;
        public final String unit;
        public final String label;

        Copy(String number, String unit, String label) {
            this.number = number;
            this.unit = unit;
            this.label = label;
        }
    }

    public static final class Civil {
        public final int year;
        public final int month;
        public final int day;

        Civil(int year, int month, int day) {
            this.year = year;
            this.month = month;
            this.day = day;
        }
    }

    public static Copy copy(int days) {
        if (days == 0) return new Copy("0", "就是今天", "今天");
        if (days < 0) return new Copy(String.valueOf(-days), "天前", "已经过去");
        return new Copy(String.valueOf(days), "天后", "倒数日");
    }

    public static int daysUntil(Spec spec, int todayYear, int todayMonth, int todayDay) {
        if (spec == null) return 0;
        int[] parts = parseDate(spec.date);
        if (parts == null) return 0;
        if (!spec.yearly) {
            Civil normalized = normalize(parts[0], parts[1], parts[2]);
            if (normalized == null) return 0;
            return civilDiff(normalized.year, normalized.month, normalized.day, todayYear, todayMonth, todayDay);
        }
        // 月份本身非法时，JS 的 daysUntil 得到 Invalid Date，天数按 0。
        if (parts[1] < 1 || parts[1] > 12) return 0;
        Civil target = spec.lunar
            ? nextLunar(spec, parts, todayYear, todayMonth, todayDay)
            : nextSolar(parts[1], parts[2], todayYear, todayMonth, todayDay);
        if (target == null) {
            Civil normalized = normalize(parts[0], parts[1], parts[2]);
            if (normalized == null) return 0;
            return civilDiff(normalized.year, normalized.month, normalized.day, todayYear, todayMonth, todayDay);
        }
        return civilDiff(target.year, target.month, target.day, todayYear, todayMonth, todayDay);
    }

    public static int nearestIndex(List<Spec> items, int todayYear, int todayMonth, int todayDay) {
        int upcoming = -1;
        int upcomingDays = Integer.MAX_VALUE;
        int past = -1;
        int pastDays = Integer.MIN_VALUE;
        for (int index = 0; index < items.size(); index++) {
            int days = daysUntil(items.get(index), todayYear, todayMonth, todayDay);
            if (days >= 0) {
                if (upcoming < 0 || days < upcomingDays) {
                    upcoming = index;
                    upcomingDays = days;
                }
            } else if (past < 0 || days > pastDays) {
                past = index;
                pastDays = days;
            }
        }
        return upcoming >= 0 ? upcoming : past;
    }

    static long daysFromCivil(int year, int month, int day) {
        int y = year - (month <= 2 ? 1 : 0);
        int era = y / 400;
        int yoe = y - era * 400;
        int doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
        int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097L + doe - 719468L;
    }

    static Civil civilFromDays(long ordinal) {
        long z = ordinal + 719468L;
        long era = z / 146097L;
        long doe = z - era * 146097L;
        long yoe = (doe - doe / 1460L + doe / 36524L - doe / 146096L) / 365L;
        int year = (int) (yoe + era * 400L);
        long doy = doe - (365L * yoe + yoe / 4L - yoe / 100L);
        int mp = (int) ((5L * doy + 2L) / 153L);
        int day = (int) (doy - (153L * mp + 2L) / 5L + 1L);
        int month = mp + (mp < 10 ? 3 : -9);
        year += month <= 2 ? 1 : 0;
        return new Civil(year, month, day);
    }

    static int leapMonth(int year) {
        return LUNAR_INFO[year - 1900] & 0xf;
    }

    static LunarDate solarToLunar(int year, int month, int day) {
        if (year < 1900 || year > 2100) return null;
        if (year == 1900 && month == 1 && day < 31) return null;
        long offset = daysFromCivil(year, month, day) - daysFromCivil(1900, 1, 31);
        if (offset < 0) return null;
        int temp = 0;
        int index = 1900;
        for (index = 1900; index < 2101 && offset > 0; index++) {
            temp = lunarYearDays(index);
            offset -= temp;
        }
        if (offset < 0) {
            offset += temp;
            index--;
        }
        int lunarYear = index;
        int leap = leapMonth(lunarYear);
        boolean isLeap = false;
        for (index = 1; index < 13 && offset > 0; index++) {
            if (leap > 0 && index == leap + 1 && !isLeap) {
                index--;
                isLeap = true;
                temp = leapDays(lunarYear);
            } else {
                temp = monthDays(lunarYear, index);
            }
            if (isLeap && index == leap + 1) isLeap = false;
            offset -= temp;
        }
        if (offset == 0 && leap > 0 && index == leap + 1) {
            if (isLeap) isLeap = false;
            else {
                isLeap = true;
                index--;
            }
        }
        if (offset < 0) {
            offset += temp;
            index--;
        }
        return new LunarDate(lunarYear, index, (int) offset + 1, isLeap);
    }

    static Civil lunarToSolar(int year, int month, int day, boolean isLeapMonth) {
        int leap = leapMonth(year);
        if (isLeapMonth && leap != month) return null;
        if ((year == 2100 && month == 12 && day > 1) || (year == 1900 && month == 1 && day < 31)) return null;
        int length = monthDays(year, month);
        int limit = isLeapMonth ? leapDays(year) : length;
        if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > limit) return null;
        long offset = 0;
        for (int index = 1900; index < year; index++) offset += lunarYearDays(index);
        boolean addedLeap = false;
        for (int index = 1; index < month; index++) {
            if (!addedLeap && leap <= index && leap > 0) {
                offset += leapDays(year);
                addedLeap = true;
            }
            offset += monthDays(year, index);
        }
        if (isLeapMonth) offset += length;
        return civilFromDays(daysFromCivil(1900, 1, 31) + offset + day - 1);
    }

    private static int lunarYearDays(int year) {
        int sum = 348;
        for (int bit = 0x8000; bit > 0x8; bit >>= 1) if ((LUNAR_INFO[year - 1900] & bit) != 0) sum++;
        return sum + leapDays(year);
    }

    private static int leapDays(int year) {
        if (leapMonth(year) != 0) return (LUNAR_INFO[year - 1900] & 0x10000) != 0 ? 30 : 29;
        return 0;
    }

    private static int monthDays(int year, int month) {
        if (month > 12 || month < 1) return -1;
        return (LUNAR_INFO[year - 1900] & (0x10000 >> month)) != 0 ? 30 : 29;
    }

    private static int lunarMonthLength(int year, int month, boolean leap) {
        if (leap) return leapMonth(year) == month ? leapDays(year) : 0;
        return monthDays(year, month);
    }

    private static int[] parseDate(String date) {
        if (date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        return new int[] {
            Integer.parseInt(date.substring(0, 4)),
            Integer.parseInt(date.substring(5, 7)),
            Integer.parseInt(date.substring(8, 10))
        };
    }

    /** 月份 1–12 时，把超出的日进位到后面的月份，和 JS Date 一样。月份本身非法则无法换算。 */
    private static Civil normalize(int year, int month, int day) {
        if (month < 1 || month > 12 || day < 1) return null;
        while (day > solarMonthLength(year, month)) {
            day -= solarMonthLength(year, month);
            month++;
            if (month > 12) {
                month = 1;
                year++;
            }
        }
        return new Civil(year, month, day);
    }

    private static int solarMonthLength(int year, int month) {
        if (month == 2) return isLeapYear(year) ? 29 : 28;
        if (month == 4 || month == 6 || month == 9 || month == 11) return 30;
        return 31;
    }

    private static boolean isLeapYear(int year) {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }

    private static int civilDiff(int year, int month, int day, int todayYear, int todayMonth, int todayDay) {
        return (int) (daysFromCivil(year, month, day) - daysFromCivil(todayYear, todayMonth, todayDay));
    }

    private static Civil nextSolar(int month, int day, int todayYear, int todayMonth, int todayDay) {
        long today = daysFromCivil(todayYear, todayMonth, todayDay);
        for (int year = todayYear; year <= todayYear + 1; year++) {
            int useDay = Math.min(day, solarMonthLength(year, month));
            if (daysFromCivil(year, month, useDay) >= today) return new Civil(year, month, useDay);
        }
        return null;
    }

    private static Civil nextLunar(Spec spec, int[] anchor, int todayYear, int todayMonth, int todayDay) {
        int month = spec.lunarMonth;
        int day = spec.lunarDay;
        boolean leap = spec.lunarLeap;
        boolean explicit = month >= 1 && month <= 12 && day >= 1 && day <= 30;
        if (!explicit) {
            Civil normalized = normalize(anchor[0], anchor[1], anchor[2]);
            if (normalized == null) return null;
            LunarDate lunar = solarToLunar(normalized.year, normalized.month, normalized.day);
            if (lunar == null) return null;
            month = lunar.month;
            day = lunar.day;
            leap = lunar.leap;
        }
        long today = daysFromCivil(todayYear, todayMonth, todayDay);
        LunarDate todayLunar = solarToLunar(todayYear, todayMonth, todayDay);
        int start = todayLunar == null ? 1900 : todayLunar.year;
        for (int year = start; year <= 2100; year++) {
            int length = lunarMonthLength(year, month, leap);
            if (length == 0) continue;
            Civil solar = lunarToSolar(year, month, Math.min(day, length), leap);
            if (solar == null) continue;
            if (daysFromCivil(solar.year, solar.month, solar.day) >= today) return solar;
        }
        return null;
    }
}
