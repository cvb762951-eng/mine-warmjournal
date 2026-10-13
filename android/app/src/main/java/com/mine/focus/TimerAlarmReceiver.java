package com.mine.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
public class TimerAlarmReceiver extends BroadcastReceiver {
    public static final String ACTION_RING = "com.mine.focus.action.RING_TIMER";
    public static final String ACTION_STOP = "com.mine.focus.action.STOP_TIMER_ALARM";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_STOP.equals(intent.getAction())) {
            TimerAlarmService.stop(context);
            return;
        }
        TimerAlarmService.start(context, intent.getStringExtra("task"), intent.getStringExtra("label"));
    }
}
