package com.mine.focus;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Minimal state bridge: native decides whether to consume Android's system back key. */
@CapacitorPlugin(name = "SystemBack")
public class SystemBackPlugin extends Plugin {

    @PluginMethod
    public void setAiChatActive(PluginCall call) {
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            activity.setAiChatSystemBackActive(call.getBoolean("active", false));
        }
        call.resolve();
    }

    @PluginMethod
    public void setSubpageActive(PluginCall call) {
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            activity.setSubpageSystemBackActive(call.getBoolean("active", false));
        }
        call.resolve();
    }

    @PluginMethod
    public void setVideoGestureExclusion(PluginCall call) {
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            activity.setVideoGestureExclusionActive(call.getBoolean("active", false));
        }
        call.resolve();
    }
}
