package kz.raz.tv;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Обновление приложения по воздуху.
 * При запуске и раз в 6 часов смотрим последний выпуск «tv-NNN» на GitHub; если он новее —
 * скачиваем APK в фоне и показываем системное окно установки (Android требует одно нажатие OK).
 */
public class Updater {
  static final String RELEASES = "https://api.github.com/repos/RazgulyaevEvgeny/raz-studio-crm/releases?per_page=15";
  private final Activity a;
  private final Handler h = new Handler(Looper.getMainLooper());
  private boolean busy;
  public interface Log { void l(String t); }
  private final Log log;

  public Updater(Activity a, Log log) { this.a = a; this.log = log; }

  private final Runnable tick = new Runnable() { @Override public void run() { check(false); h.postDelayed(this, 6 * 3600_000L); } };
  public void start() { h.postDelayed(tick, 90_000); }   // через 1,5 минуты после запуска, когда экран уже идёт
  public void stop() { h.removeCallbacks(tick); }

  /** manual — проверка по кнопке: сообщаем результат на экране. */
  public void check(final boolean manual) {
    if (busy) return; busy = true;
    if (manual) toast("Проверяю обновления…");
    new Thread(() -> {
      String msg = null;
      try {
        JSONArray rs = new JSONArray(get(RELEASES));
        JSONObject best = null; int bestCode = 0;
        for (int i = 0; i < rs.length(); i++) {
          JSONObject r = rs.getJSONObject(i);
          if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue;
          String tag = r.optString("tag_name");
          if (!tag.startsWith("tv-")) continue;
          int code; try { code = Integer.parseInt(tag.substring(3)); } catch (Exception e) { continue; }
          if (code > bestCode) { bestCode = code; best = r; }
        }
        if (best == null || bestCode <= BuildConfig.VERSION_CODE) { msg = manual ? "Стоит последняя версия " + BuildConfig.VERSION_NAME : null; }
        else {
          String url = null; JSONArray as = best.optJSONArray("assets");
          for (int i = 0; as != null && i < as.length(); i++) { JSONObject x = as.getJSONObject(i); if (x.optString("name").endsWith(".apk")) { url = x.optString("browser_download_url"); break; } }
          if (url == null) throw new Exception("в выпуске нет APK");
          log.l("есть обновление " + best.optString("name", "tv-" + bestCode) + " — скачиваю");
          final File f = new File(a.getCacheDir(), "update.apk");
          download(url, f);
          final String name = best.optString("name", "");
          h.post(() -> install(f, name));
        }
      } catch (Throwable e) { msg = manual ? "Не удалось проверить обновления: нет связи с GitHub" : null; log.l("обновление: ошибка " + e.getMessage()); }
      final String m = msg;
      h.post(() -> { busy = false; if (m != null) toast(m); });
    }, "updater").start();
  }

  private void install(File f, String name) {
    // Android 8+: один раз нужно разрешить «Студии» ставить приложения
    if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
      toast("Разрешите «Студии» устанавливать обновления — включите переключатель и нажмите «Назад»");
      try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); } catch (Exception ignored) {}
      h.postDelayed(() -> check(false), 60_000);
      return;
    }
    try {
      PackageInstaller pi = a.getPackageManager().getPackageInstaller();
      PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
      p.setAppPackageName(a.getPackageName());
      int sid = pi.createSession(p);
      try (PackageInstaller.Session s = pi.openSession(sid)) {
        try (OutputStream out = s.openWrite("studio.apk", 0, f.length()); InputStream in = new FileInputStream(f)) {
          byte[] b = new byte[65536]; int r; while ((r = in.read(b)) > 0) out.write(b, 0, r); s.fsync(out);
        }
        Intent i = new Intent(a, Receiver.class);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        s.commit(PendingIntent.getBroadcast(a, 7, i, fl).getIntentSender());
      }
      toast("Обновление " + name + " готово — нажмите «Установить» (OK на пульте)");
      log.l("обновление: жду подтверждения установки");
    } catch (Throwable e) { log.l("обновление: не удалось установить — " + e.getMessage()); }
  }

  /** Ответ системы установки: показать окно подтверждения или сообщить результат. */
  public static class Receiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
      int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
      if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
        Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
        if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); try { c.startActivity(confirm); } catch (Exception ignored) {} }
      } else if (st != PackageInstaller.STATUS_SUCCESS) {
        String m = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        Toast.makeText(c, "Обновление не установилось" + (m != null ? ": " + m : ""), Toast.LENGTH_LONG).show();
      }
    }
  }

  private void toast(String t) { h.post(() -> Toast.makeText(a, t, Toast.LENGTH_LONG).show()); }

  private static String get(String u) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
    c.setConnectTimeout(15000); c.setReadTimeout(20000); c.setRequestProperty("Accept", "application/vnd.github+json"); c.setRequestProperty("User-Agent", "raz-studio-tv");
    try (InputStream in = c.getInputStream()) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int r; while ((r = in.read(b)) > 0) bo.write(b, 0, r); return bo.toString("UTF-8"); }
    finally { c.disconnect(); }
  }

  private static void download(String u, File f) throws Exception {
    File tmp = new File(f.getPath() + ".tmp");
    for (int hop = 0; hop < 5; hop++) {   // GitHub отдаёт файл через переадресацию на другой адрес
      HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
      c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(60000); c.setRequestProperty("User-Agent", "raz-studio-tv");
      int code = c.getResponseCode();
      if (code >= 300 && code < 400) { u = c.getHeaderField("Location"); c.disconnect(); continue; }
      if (code != 200) { c.disconnect(); throw new Exception("HTTP " + code); }
      try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) { byte[] b = new byte[65536]; int r; while ((r = in.read(b)) > 0) out.write(b, 0, r); }
      finally { c.disconnect(); }
      f.delete();
      if (tmp.length() < 100_000 || !tmp.renameTo(f)) throw new Exception("файл не скачался");
      return;
    }
    throw new Exception("слишком много переадресаций");
  }
}
