package com.mine.focus;

import android.content.Intent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

@CapacitorPlugin(name = "TimerAlarm")
public class TimerAlarmPlugin extends Plugin {
    @PluginMethod
    public void schedule(PluginCall call) {
        Long at = call.getLong("at");
        if (at == null) {
            call.reject("缺少结束时间");
            return;
        }
        String task = call.getString("task", "本阶段");
        String label = call.getString("label", "计时");
        TimerAlarmScheduler.schedule(getContext(), at, task, label);
        call.resolve();
    }

    @PluginMethod
    public void cancelScheduled(PluginCall call) {
        TimerAlarmScheduler.cancelScheduled(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TimerAlarmScheduler.cancelScheduled(getContext());
        TimerAlarmService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isRinging(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ringing", TimerAlarmService.isRinging(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean keep = call.getBoolean("keep", true);
        getActivity().runOnUiThread(() -> {
            if (keep) {
                getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void startFocusNotification(PluginCall call) {
        Long endAt = call.getLong("endAt");
        if (endAt == null) {
            call.reject("缺少结束时间");
            return;
        }
        String task = call.getString("task", "专注中");
        FocusTimerService.start(getContext(), task, endAt);
        call.resolve();
    }

    @PluginMethod
    public void stopFocusNotification(PluginCall call) {
        FocusTimerService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void updateCountdownWidget(PluginCall call) {
        String theme = call.getString("theme", "classic");
        JSArray items = call.getArray("items");
        JSONArray clean = CountdownWidgetStore.sanitize(items);
        CountdownWidgetStore.saveSnapshot(getContext(), theme, clean);
        CountdownWidgetProvider.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void consumeWidgetRoute(PluginCall call) {
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        JSObject result = new JSObject();
        String route = intent == null ? "" : intent.getStringExtra("route");
        if (!"countdown".equals(route)) {
            call.resolve(result);
            return;
        }
        String id = intent.getStringExtra("id");
        result.put("route", "countdown");
        result.put("id", id == null ? "" : id);
        intent.removeExtra("route");
        intent.removeExtra("id");
        call.resolve(result);
    }
}
