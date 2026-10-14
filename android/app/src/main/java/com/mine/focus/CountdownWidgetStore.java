package com.mine.focus;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** 小组件只保存标题、日期和算天数要用的字段。备注、图片和天数都不进这里。 */
public final class CountdownWidgetStore {
    static final String PREFS = "countdown_widget";
    private static final String ITEMS = "items";
    private static final String THEME = "theme";

    private CountdownWidgetStore() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void saveSnapshot(Context context, String theme, JSONArray items) {
        prefs(context).edit()
            .putString(THEME, CountdownWidgetTheme.normalize(theme))
            .putString(ITEMS, items == null ? "[]" : items.toString())
            .remove("title")
            .remove("days")
            .remove("unit")
            .remove("label")
            .apply();
    }

    public static String theme(Context context) {
        return CountdownWidgetTheme.normalize(prefs(context).getString(THEME, "classic"));
    }

    public static List<CountdownDays.Spec> items(Context context) {
        List<CountdownDays.Spec> list = new ArrayList<>();
        String raw = prefs(context).getString(ITEMS, "[]");
        try {
            JSONArray array = new JSONArray(raw == null ? "[]" : raw);
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.optJSONObject(index);
                if (item == null) continue;
                CountdownDays.Spec spec = toSpec(item);
                if (!spec.id.isEmpty() && !spec.title.isEmpty() && !spec.date.isEmpty()) list.add(spec);
            }
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
        return list;
    }

    public static JSONArray sanitize(JSONArray raw) {
        JSONArray clean = new JSONArray();
        if (raw == null) return clean;
        for (int index = 0; index < raw.length(); index++) {
            JSONObject source = raw.optJSONObject(index);
            if (source == null) continue;
            try {
                String id = source.optString("id", "").trim();
                String title = source.optString("title", "").trim();
                String date = source.optString("date", "");
                if (id.isEmpty() || title.isEmpty() || !date.matches("\\d{4}-\\d{2}-\\d{2}")) continue;
                if (id.length() > 80) id = id.substring(0, 80);
                if (title.length() > 40) title = title.substring(0, 40);
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("title", title);
                item.put("date", date);
                if ("yearly".equals(source.optString("repeat", ""))) item.put("repeat", "yearly");
                if (source.optBoolean("lunar", false)) {
                    item.put("lunar", true);
                    int month = source.optInt("lunarMonth", 0);
                    int day = source.optInt("lunarDay", 0);
                    if (month >= 1 && month <= 12) item.put("lunarMonth", month);
                    if (day >= 1 && day <= 30) item.put("lunarDay", day);
                    if (source.optBoolean("lunarLeap", false)) item.put("lunarLeap", true);
                }
                clean.put(item);
            } catch (Exception ignored) {
            }
        }
        return clean;
    }

    public static void saveSelection(Context context, int widgetId, String countdownId) {
        prefs(context).edit().putString(selectionKey(widgetId), countdownId == null ? "" : countdownId).apply();
    }

    public static String selection(Context context, int widgetId) {
        return prefs(context).getString(selectionKey(widgetId), "");
    }

    public static void clearSelection(Context context, int widgetId) {
        prefs(context).edit().remove(selectionKey(widgetId)).apply();
    }

    private static String selectionKey(int widgetId) {
        return "selection_" + widgetId;
    }

    private static CountdownDays.Spec toSpec(JSONObject item) {
        return new CountdownDays.Spec(
            item.optString("id", ""),
            item.optString("title", ""),
            item.optString("date", ""),
            "yearly".equals(item.optString("repeat", "")),
            item.optBoolean("lunar", false),
            item.optInt("lunarMonth", 0),
            item.optInt("lunarDay", 0),
            item.optBoolean("lunarLeap", false)
        );
    }
}
