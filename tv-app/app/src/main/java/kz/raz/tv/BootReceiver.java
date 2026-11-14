package kz.raz.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Запускает экран после включения приставки. */
public class BootReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context c, Intent i) {
    try { c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
  }
}
