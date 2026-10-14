package com.mine.focus;

import org.junit.Test;

import java.util.Arrays;
import java.util.Calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * 这些数字和 tests/countdown-widget-days.test.mjs 里的同一组例子对齐。
 * 今天固定为 2026-10-14。
 */
public class CountdownDaysTest {
    private static final int YEAR = 2026;
    private static final int MONTH = 10;
    private static final int DAY = 14;

    private static CountdownDays.Spec spec(String date, boolean yearly, boolean lunar, int lunarMonth, int lunarDay, boolean lunarLeap) {
        return new CountdownDays.Spec("id", "标题", date, yearly, lunar, lunarMonth, lunarDay, lunarLeap);
    }

    private static int days(CountdownDays.Spec spec) {
        return CountdownDays.daysUntil(spec, YEAR, MONTH, DAY);
    }

    @Test
    public void civilOrdinalMatchesTheSharedCalendar() {
        assertEquals(0L, CountdownDays.daysFromCivil(1970, 1, 1));
        assertEquals(20740L, CountdownDays.daysFromCivil(2026, 10, 14));
        assertEquals(-25537L, CountdownDays.daysFromCivil(1900, 1, 31));
        CountdownDays.Civil civil = CountdownDays.civilFromDays(0);
        assertEquals(1970, civil.year);
        assertEquals(1, civil.month);
        assertEquals(1, civil.day);
    }

    @Test
    public void plainDatesMatchDaysUntil() {
        assertEquals(0, days(spec("2026-10-14", false, false, 0, 0, false)));
        assertEquals(1, days(spec("2026-10-15", false, false, 0, 0, false)));
        assertEquals(-1, days(spec("2026-10-13", false, false, 0, 0, false)));
        assertEquals(72, days(spec("2026-12-25", false, false, 0, 0, false)));
        assertEquals(79, days(spec("2027-01-01", false, false, 0, 0, false)));
        // 2023-02-29 和 JS Date 一样进位到 3 月 1 日。
        assertEquals(-1323, days(spec("2023-02-29", false, false, 0, 0, false)));
        assertEquals(0, days(spec("2023-13-01", false, false, 0, 0, false)));
        assertEquals(0, days(spec("2023-13-01", true, false, 0, 0, false)));
        assertEquals(0, days(spec("不是日期", false, false, 0, 0, false)));
    }

    @Test
    public void yearlySolarAndLunarMatchTheJsRules() {
        assertEquals(72, days(spec("2000-12-25", true, false, 0, 0, false)));
        assertEquals(79, days(spec("2000-01-01", true, false, 0, 0, false)));
        assertEquals(0, days(spec("2000-10-14", true, false, 0, 0, false)));
        assertEquals(364, days(spec("2000-10-13", true, false, 0, 0, false)));
        assertEquals(137, days(spec("2024-02-29", true, false, 0, 0, false)));
        assertEquals(115, days(spec("2024-02-10", true, true, 0, 0, false)));
        assertEquals(-977, days(spec("2024-02-10", false, true, 0, 0, false)));
        assertEquals(234, days(spec("1995-06-18", true, true, 5, 1, false)));
        assertEquals(11543, days(spec("2020-05-23", true, true, 4, 1, true)));
    }

    @Test
    public void knownLunarDatesRoundTrip() {
        assertLunar(2024, 2, 10, 2024, 1, 1, false);
        assertLunar(2025, 1, 29, 2025, 1, 1, false);
        assertLunar(2026, 2, 17, 2026, 1, 1, false);
        assertLunar(2023, 1, 22, 2023, 1, 1, false);
        assertLunar(1987, 11, 1, 1987, 9, 10, false);
        assertEquals(4, CountdownDays.leapMonth(2020));
        assertEquals(2, CountdownDays.leapMonth(2023));
        assertEquals(6, CountdownDays.leapMonth(2025));
        assertEquals(6, CountdownDays.leapMonth(1987));
        int checked = 0;
        for (int year = 2020; year <= 2030; year++) {
            for (int month = 1; month <= 12; month++) {
                Calendar calendar = Calendar.getInstance();
                calendar.set(year, month - 1, 1);
                int length = calendar.getActualMaximum(Calendar.DAY_OF_MONTH);
                for (int day = 1; day <= length; day += 7) {
                    CountdownDays.LunarDate lunar = CountdownDays.solarToLunar(year, month, day);
                    assertNotNull(lunar);
                    CountdownDays.Civil back = CountdownDays.lunarToSolar(lunar.year, lunar.month, lunar.day, lunar.leap);
                    assertNotNull(back);
                    assertEquals(year, back.year);
                    assertEquals(month, back.month);
                    assertEquals(day, back.day);
                    checked++;
                }
            }
        }
        assertTrue(checked > 100);
        assertNull(CountdownDays.solarToLunar(1899, 1, 1));
    }

    @Test
    public void nearestKeepsUpcomingBeforePastAndStableTies() {
        CountdownDays.Spec later = spec("2026-12-25", false, false, 0, 0, false);
        CountdownDays.Spec sooner = spec("2026-10-20", false, false, 0, 0, false);
        CountdownDays.Spec past = spec("2026-01-01", false, false, 0, 0, false);
        assertEquals(1, CountdownDays.nearestIndex(Arrays.asList(later, sooner, past), YEAR, MONTH, DAY));
        CountdownDays.Spec sameA = new CountdownDays.Spec("a", "甲", "2026-11-01", false, false, 0, 0, false);
        CountdownDays.Spec sameB = new CountdownDays.Spec("b", "乙", "2026-11-01", false, false, 0, 0, false);
        assertEquals(0, CountdownDays.nearestIndex(Arrays.asList(sameA, sameB), YEAR, MONTH, DAY));
        assertEquals(0, CountdownDays.nearestIndex(Arrays.asList(past, spec("2020-01-01", false, false, 0, 0, false)), YEAR, MONTH, DAY));
        assertEquals(-1, CountdownDays.nearestIndex(Arrays.asList(), YEAR, MONTH, DAY));
    }

    @Test
    public void copyUsesTheSameWordsAsTheWidget() {
        CountdownDays.Copy today = CountdownDays.copy(0);
        assertEquals("0", today.number);
        assertEquals("就是今天", today.unit);
        assertEquals("今天", today.label);
        CountdownDays.Copy future = CountdownDays.copy(3);
        assertEquals("3", future.number);
        assertEquals("天后", future.unit);
        assertEquals("倒数日", future.label);
        CountdownDays.Copy ago = CountdownDays.copy(-2);
        assertEquals("2", ago.number);
        assertEquals("天前", ago.unit);
        assertEquals("已经过去", ago.label);
        assertFalse(CountdownDays.LUNAR_INFO.length == 0);
        assertEquals(201, CountdownDays.LUNAR_INFO.length);
    }

    private static void assertLunar(int year, int month, int day, int lunarYear, int lunarMonth, int lunarDay, boolean leap) {
        CountdownDays.LunarDate lunar = CountdownDays.solarToLunar(year, month, day);
        assertNotNull(lunar);
        assertEquals(lunarYear, lunar.year);
        assertEquals(lunarMonth, lunar.month);
        assertEquals(lunarDay, lunar.day);
        assertEquals(leap, lunar.leap);
    }
}
