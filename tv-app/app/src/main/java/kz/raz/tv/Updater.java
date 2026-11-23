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
  /** Плашка на экране: текст, процент (-1 — без полосы), hideMs — через сколько убрать (0 — держать). */
  public interface Ui { void show(String t, int pct, long hideMs); }
  private final Log log; private final Ui ui;
  /** Последний список выпусков для окна «Обновления»: {код, название, дата}. */
  public final java.util.List<String[]> list = new java.util.ArrayList<>();
  public volatile String state = "ещё не проверял";
  public boolean busy() { return busy; }

  public Updater(Activity a, Log log, Ui ui) { this.a = a; this.log = log; this.ui = ui; }
  private void ui(String t, int pct, long hide) { state = t; h.post(() -> ui.show(t, pct, hide)); }

  private final Runnable tick = new Runnable() { @Override public void run() { check(false); h.postDelayed(this, 6 * 3600_000L); } };
  public void start() { h.postDelayed(tick, 90_000); }   // через 1,5 минуты после запуска, когда экран уже идёт
  public void stop() { h.removeCallbacks(tick); }

  /** manual — проверка по кнопке: сообщаем результат на экране. */
  public void check(final boolean manual) {
    if (busy) return; busy = true;
    if (manual) ui("Проверяю обновления…", -1, 0);
    new Thread(() -> {
      try {
        JSONArray rs = new JSONArray(get(RELEASES));
        JSONObject best = null; int bestCode = 0;
        java.util.List<String[]> l = new java.util.ArrayList<>();
        for (int i = 0; i < rs.length(); i++) {
          JSONObject r = rs.getJSONObject(i);
          if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue;
          String tag = r.optString("tag_name");
          if (!tag.startsWith("tv-")) continue;
          int code; try { code = Integer.parseInt(tag.substring(3)); } catch (Exception e) { continue; }
          if (code > bestCode) { bestCode = code; best = r; }
          String d = r.optString("published_at", ""); if (d.length() >= 16) d = d.substring(8, 10) + "." + d.substring(5, 7) + " " + d.substring(11, 16) + " UTC";
          l.add(new String[]{ String.valueOf(code), r.optString("name", tag), d });
        }
        synchronized (list) { list.clear(); list.addAll(l); }
        if (best == null || bestCode <= BuildConfig.VERSION_CODE) { state = "стоит последняя версия"; if (manual) ui("Стоит последняя версия " + BuildConfig.VERSION_NAME + " ✓", -1, 6000); }
        else {
          String url = null; JSONArray as = best.optJSONArray("assets");
          for (int i = 0; as != null && i < as.length(); i++) { JSONObject x = as.getJSONObject(i); if (x.optString("name").endsWith(".apk")) { url = x.optString("browser_download_url"); break; } }
          if (url == null) throw new Exception("в выпуске нет APK");
          final String name = best.optString("name", "tv-" + bestCode);
          log.l("есть обновление " + name + " — скачиваю");
          ui("Есть обновление " + name + " — скачиваю…", 0, 0);
          final File f = new File(a.getCacheDir(), "update.apk");
          download(url, f, pct -> ui("Скачиваю обновление " + name + " — " + pct + "%", pct, 0));
          ui("Устанавливаю " + name + "…", 100, 0);
          h.post(() -> install(f, name));
        }
      } catch (Throwable e) { log.l("обновление: ошибка " + e.getMessage()); state = "ошибка: " + e.getMessage();
        if (manual) ui("Не удалось проверить обновления — нет интернета или GitHub не отвечает", -1, 8000);
        else ui("Обновление не скачалось, попробую позже", -1, 6000); }
      h.post(() -> busy = false);
    }, "updater").start();
  }

  private void install(File f, String name) {
    // Android 8+: один раз нужно разрешить «Студии» ставить приложения
    if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
      ui("Разрешите «Студии» устанавливать обновления: включите переключатель и нажмите «Назад»", -1, 20000);
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
      ui("Обновление " + name + " готово — на экране нажмите «Установить» (OK). Приложение перезапустится само", -1, 60000);
      log.l("обновление: жду подтверждения установки");
    } catch (Throwable e) { log.l("обновление: не удалось установить — " + e.getMessage()); ui("Не удалось установить: " + e.getMessage(), -1, 10000); }
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
        Toast.makeText(c, "Обновление не установилось" + (m != null ? ": " + m : "") + ". Откройте окно обновлений: ↑ три раза", Toast.LENGTH_LONG).show();
      }
    }
  }


  private static String get(String u) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
    c.setConnectTimeout(15000); c.setReadTimeout(20000); c.setRequestProperty("Accept", "application/vnd.github+json"); c.setRequestProperty("User-Agent", "raz-studio-tv");
    try (InputStream in = c.getInputStream()) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int r; while ((r = in.read(b)) > 0) bo.write(b, 0, r); return bo.toString("UTF-8"); }
    finally { c.disconnect(); }
  }

  interface Pct { void p(int pct); }
  private static void download(String u, File f, Pct pc) throws Exception {
    File tmp = new File(f.getPath() + ".tmp");
    for (int hop = 0; hop < 5; hop++) {   // GitHub отдаёт файл через переадресацию на другой адрес
      HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
      c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(60000); c.setRequestProperty("User-Agent", "raz-studio-tv");
      int code = c.getResponseCode();
      if (code >= 300 && code < 400) { u = c.getHeaderField("Location"); c.disconnect(); continue; }
      if (code != 200) { c.disconnect(); throw new Exception("HTTP " + code); }
      long total = c.getContentLength(), got = 0; int last = -1;
      try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) { byte[] b = new byte[65536]; int r;
        while ((r = in.read(b)) > 0) { out.write(b, 0, r); got += r; if (total > 0) { int p = (int) (got * 100 / total); if (p >= last + 5) { last = p; pc.p(p); } } } }
      finally { c.disconnect(); }
      f.delete();
      if (tmp.length() < 100_000 || !tmp.renameTo(f)) throw new Exception("файл не скачался");
      return;
    }
    throw new Exception("слишком много переадресаций");
  }
}
