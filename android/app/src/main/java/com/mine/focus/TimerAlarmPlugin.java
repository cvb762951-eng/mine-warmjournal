package com.mine.focus;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
        String title = call.getString("title", "");
        int days = call.getInt("days", -1);
        String unit = call.getString("unit", "天后");
        String label = call.getString("label", "倒数日");
        getContext().getSharedPreferences("countdown_widget", android.content.Context.MODE_PRIVATE)
            .edit()
            .putString("title", title)
            .putInt("days", days)
            .putString("unit", unit)
            .putString("label", label)
            .apply();
        CountdownWidgetProvider.updateAll(getContext());
        call.resolve();
    }
}
