package kz.raz.tv;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Музыка «Моя волна» — играет сама приставка (ExoPlayer), а не страница.
 * Как в настоящих плеерах:
 *  • следующие 2 трека заранее скачиваются на диск приставки целиком — пропал интернет, музыка идёт дальше;
 *  • текущий трек, если он ещё не скачан, играет по сети с буфером на 10 минут вперёд (почти весь трек в памяти);
 *  • сеть пропала надолго и новых треков не получить — играем уже скачанные, пока интернет не вернётся;
 *  • сторож: если трек встал, через 15 сек перезапускаем его с того же места, через 40 — следующий.
 */
public class Music {
  public interface Ui { void now(JSONObject track, String state); void js(String code); }

  static class Track { String id, albumId, title, artist, cover; long ms; }

  private final Context ctx;
  private final Handler h = new Handler(Looper.getMainLooper());
  private final Ui ui;
  private final ExoPlayer player;
  private final ExecutorService net = Executors.newSingleThreadExecutor();   // запросы к серверу музыки
  private final ExecutorService dl = Executors.newSingleThreadExecutor();    // скачивание треков на диск
  private final File dir;
  private final LinkedList<Track> queue = new LinkedList<>();
  private final LinkedList<Track> userQueue = new LinkedList<>();   // треки, выбранные с телефона: идут раньше волны
  private String lastCmd = null;   // последняя команда пульта (id), чтобы не выполнить её дважды
  private final LinkedList<Track> played = new LinkedList<>();
  private final Set<String> downloading = new HashSet<>();
  private final LinkedList<String> log = new LinkedList<>();

  private String worker = "", key = "", st = "user:onyourwave", mood = "calm", div = "default", lang = "any", skip = "";
  private int vol = 70;
  private String batch = "", lastId = "";
  private Track cur;
  private boolean started, userPaused, refilling, offline;
  private long lastPos = -1, stuckSince = 0;
  private int errs = 0;

  public Music(Context ctx, Ui ui) {
    this.ctx = ctx; this.ui = ui;
    dir = new File(ctx.getFilesDir(), "music"); dir.mkdirs();
    // буфер: держим до 10 минут музыки вперёд — по сети почти весь трек сразу ложится в память
    DefaultLoadControl lc = new DefaultLoadControl.Builder()
        .setBufferDurationsMs(60_000, 600_000, 1_500, 3_000)
        .setTargetBufferBytes(48 * 1024 * 1024).setPrioritizeTimeOverSizeThresholds(true).build();
    DefaultMediaSourceFactory msf = new DefaultMediaSourceFactory(ctx).setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(30));
    player = new ExoPlayer.Builder(ctx).setLoadControl(lc).setMediaSourceFactory(msf).build();
    // звук приставки не отдаём никому и ни у кого не забираем
    player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), false);
    player.setHandleAudioBecomingNoisy(false);
    player.addListener(new Player.Listener() {
      @Override public void onPlaybackStateChanged(int s) {
        if (s == Player.STATE_ENDED) { if (cur != null) feedback("trackFinished", cur, (int) (player.getDuration() / 1000)); next(false); }
        if (s == Player.STATE_BUFFERING) l("жду данные трека…");
      }
      @Override public void onIsPlayingChanged(boolean p) { if (p) { errs = 0; l("играет: " + (cur != null ? cur.title : "")); } state(); }
      @Override public void onPlayerError(PlaybackException e) {
        l("ошибка плеера: " + e.getErrorCodeName());
        if (cur != null) new File(dir, "m_" + cur.id + ".mp3").delete();
        errs++;
        if (errs <= 2 && cur != null) { final long pos = Math.max(0, player.getCurrentPosition()); h.postDelayed(() -> playTrack(cur, pos), 2000L * errs); }
        else { errs = 0; h.postDelayed(() -> next(false), 1500); }
      }
    });
    h.postDelayed(watch, 5000);
  }

  // ---------- настройки со страницы (из редактора) ----------
  public void settings(JSONObject o) {
    String w = o.optString("worker", worker), k = o.optString("key", key);
    String nst = o.optString("st", st), nmood = o.optString("mood", mood), ndiv = o.optString("div", div), nlang = o.optString("lang", lang), nskip = o.optString("skip", "");
    vol = o.optInt("vol", vol); player.setVolume(Math.max(0, Math.min(100, vol)) / 100f);
    boolean wave = !nst.equals(st) || !nmood.equals(mood) || !ndiv.equals(div) || !nlang.equals(lang);
    boolean sk = !nskip.isEmpty() && !nskip.equals(skip) && !skip.isEmpty();
    worker = w; key = k; st = nst; mood = nmood; div = ndiv; lang = nlang; skip = nskip;
    JSONObject cmd = o.optJSONObject("cmd"); String cid = cmd != null ? cmd.optString("id", "") : "";
    boolean fresh = cmd != null && !cid.isEmpty() && lastCmd != null && !cid.equals(lastCmd)
      && System.currentTimeMillis() - cmd.optLong("at", 0) < 120000;   // старые команды после перезапуска не выполняем
    if (cid.length() > 0) lastCmd = cid; else if (lastCmd == null) lastCmd = "";
    if (worker.isEmpty()) return;
    if (!started) { started = true; l("музыка запускается"); feedback("radioStarted", null, -1); next(false); return; }
    if (wave) { l("сменилась волна/настроение"); synchronized (queue) { queue.clear(); } lastId = ""; batch = ""; feedback("radioStarted", null, -1); next(false); }
    else if (sk) next(true);
    if (fresh) remote(cmd);
  }

  // ---------- пульт с телефона (CRM): play/pause, назад, вперёд, включить трек, поставить в очередь ----------
  private void remote(JSONObject c) {
    String d = c.optString("do", ""); l("пульт: " + d);
    switch (d) {
      case "toggle": togglePause(); state(); break;
      case "pause": if (player.getPlayWhenReady()) togglePause(); state(); break;
      case "play": if (!player.getPlayWhenReady()) togglePause(); state(); break;
      case "next": nextTrack(); break;
      case "prev": prevTrack(); break;
      case "track": case "queue": {
        JSONObject j = c.optJSONObject("t"); if (j == null || j.optString("id", "").isEmpty()) break;
        Track t = new Track(); t.id = j.optString("id"); t.albumId = j.optString("albumId", ""); t.title = j.optString("title", ""); t.artist = j.optString("artist", ""); t.cover = j.optString("cover", ""); t.ms = j.optLong("durationMs", 0);
        if ("track".equals(d)) { synchronized (queue) { userQueue.addFirst(t); } nextTrack(); }
        else { synchronized (queue) { userQueue.addLast(t); } l("в очередь: " + t.artist + " — " + t.title); state(); prefetch(); }
        break; }
      case "unqueue": { String id = c.optString("id2", ""); synchronized (queue) { java.util.Iterator<Track> it = userQueue.iterator(); while (it.hasNext()) if (it.next().id.equals(id)) { it.remove(); break; } } state(); break; }
    }
  }
  /** Сообщить странице (а она — телефону), что играет и что дальше. */
  private void state() { if (cur == null) return; ui.now(nowJson(cur), "state"); }
  private JSONObject nowJson(Track t) {
    JSONObject o = new JSONObject();
    try { o.put("id", t.id); o.put("title", t.title); o.put("artist", t.artist); o.put("cover", t.cover); o.put("ms", t.ms);
      o.put("paused", !player.getPlayWhenReady()); o.put("pos", player.getCurrentPosition()); o.put("vol", vol);
      JSONArray up = new JSONArray(); synchronized (queue) { for (Track u : userQueue) { if (up.length() >= 8) break; up.put(new JSONObject().put("id", u.id).put("title", u.title).put("artist", u.artist).put("cover", u.cover).put("mine", true)); }
        for (Track u : queue) { if (up.length() >= 8) break; up.put(new JSONObject().put("id", u.id).put("title", u.title).put("artist", u.artist).put("cover", u.cover)); } }
      o.put("next", up); } catch (Exception ignored) {}
    return o;
  }

  /** Страница перезапустилась — заново показать в шапке текущий трек. */
  public void announce() { if (cur == null) return; ui.now(nowJson(cur), ""); }

  // ---------- пульт ----------
  public String togglePause() {
    if (cur == null) return "none";
    if (player.getPlayWhenReady()) { userPaused = true; player.pause(); l("пауза кнопкой"); return "pause"; }
    userPaused = false; player.play(); return "play";
  }
  public void nextTrack() { userPaused = false; next(true); }
  public void prevTrack() {
    userPaused = false;
    if (player.getCurrentPosition() > 8000 || played.isEmpty()) { player.seekTo(0); player.play(); return; }
    if (cur != null) synchronized (queue) { queue.addFirst(cur); }
    Track p = played.removeLast(); cur = null; playTrack(p, 0);
  }

  // ---------- очередь ----------
  private void next(boolean skipped) {
    if (skipped && cur != null) feedback("skip", cur, (int) (player.getCurrentPosition() / 1000));
    if (cur != null) { played.add(cur); if (played.size() > 30) played.removeFirst(); }
    Track t; synchronized (queue) { t = userQueue.poll(); if (t == null) t = queue.poll(); }
    if (t == null) {
      refill(() -> { Track n; synchronized (queue) { n = queue.poll(); } if (n != null) playTrack(n, 0); else offlineTrack(); });
      return;
    }
    playTrack(t, 0);
    if (queueSize() < 3) refill(null);
  }

  private int queueSize() { synchronized (queue) { return queue.size(); } }

  private void refill(final Runnable then) {
    if (refilling) { if (then != null) h.postDelayed(then, 3000); return; }
    refilling = true;
    net.execute(() -> {
      List<Track> got = new ArrayList<>(); String nb = null;
      try {
        String q = "/wave?st=" + enc(st) + "&mood=" + mood + "&div=" + div + "&lang=" + lang + (lastId.isEmpty() ? "" : "&last=" + lastId);
        JSONObject j = new JSONObject(get(api(q)));
        nb = j.optString("batchId", "");
        JSONArray a = j.optJSONArray("tracks");
        for (int i = 0; a != null && i < a.length(); i++) { JSONObject x = a.getJSONObject(i); Track t = new Track();
          t.id = x.optString("id"); t.albumId = x.optString("albumId"); t.title = x.optString("title"); t.artist = x.optString("artist"); t.cover = x.optString("cover"); t.ms = x.optLong("durationMs");
          if (!t.id.isEmpty()) got.add(t); }
      } catch (Throwable e) { }
      final String fb = nb;
      h.post(() -> {
        refilling = false;
        if (!got.isEmpty()) { offline = false; if (fb != null && !fb.isEmpty()) batch = fb; synchronized (queue) { queue.addAll(got); } lastId = got.get(got.size() - 1).id; prefetch(); }
        else { l("не удалось получить новые треки (нет связи с сервером музыки)"); }
        if (then != null) then.run();
      });
    });
  }

  /** Играем без интернета: случайный уже скачанный трек. */
  private void offlineTrack() {
    File[] fs = dir.listFiles((d, n) -> n.startsWith("m_") && n.endsWith(".mp3"));
    if (fs == null || fs.length == 0) { l("нет интернета и нет скачанных треков — пробую снова через 10 сек"); h.postDelayed(() -> next(false), 10000); return; }
    offline = true;
    File f = fs[new Random().nextInt(fs.length)];
    Track t = new Track(); t.id = f.getName().substring(2, f.getName().length() - 4); t.title = "Из памяти приставки"; t.artist = "нет связи с Яндекс Музыкой"; t.cover = "";
    JSONObject meta = readMeta(t.id); if (meta != null) { t.title = meta.optString("title", t.title); t.artist = meta.optString("artist", t.artist); t.cover = meta.optString("cover", ""); t.albumId = meta.optString("albumId", ""); }
    l("играю из памяти приставки: " + t.title);
    playTrack(t, 0);
    h.postDelayed(() -> refill(null), 20000);
  }

  private void playTrack(final Track t, final long pos) {
    cur = t; errs = Math.min(errs, 2); stuckSince = 0; lastPos = -1;
    File f = new File(dir, "m_" + t.id + ".mp3");
    if (f.exists() && f.length() > 50_000) { start(t, android.net.Uri.fromFile(f).toString(), pos, "из памяти"); prefetch(); return; }
    net.execute(() -> {
      String u = null; try { u = new JSONObject(get(api("/url?id=" + t.id))).optString("url", null); } catch (Throwable ignored) {}
      final String url = u;
      h.post(() -> {
        if (cur != t) return;
        if (url == null) { l("нет ссылки на трек — следующий"); h.postDelayed(() -> next(false), 2000); return; }
        start(t, url, pos, "по сети"); prefetch();
      });
    });
  }

  private void start(Track t, String uri, long pos, String how) {
    player.setMediaItem(MediaItem.fromUri(uri), pos);
    player.prepare();
    if (!userPaused) player.play();
    if (pos == 0) feedback("trackStarted", t, -1);
    l("трек: " + t.artist + " — " + t.title + " (" + how + ")");
    ui.now(nowJson(t), how);
  }

  // ---------- скачивание вперёд ----------
  private void prefetch() {
    List<Track> want = new ArrayList<>(); synchronized (queue) { for (Track u : userQueue) { if (want.size() >= 2) break; want.add(u); } for (int i = 0; i < queue.size() && want.size() < 2; i++) want.add(queue.get(i)); }
    if (cur != null && !cur.title.equals("Из памяти приставки")) want.add(0, cur);
    for (final Track t : want) {
      final File f = new File(dir, "m_" + t.id + ".mp3");
      if (f.exists() || downloading.contains(t.id)) continue;
      downloading.add(t.id);
      dl.execute(() -> {
        boolean ok = false;
        try {
          String url = new JSONObject(get(api("/url?id=" + t.id))).optString("url", null);
          if (url != null) ok = save(url, f);
          if (ok) writeMeta(t);
        } catch (Throwable ignored) {}
        final boolean fok = ok;
        h.post(() -> { downloading.remove(t.id); if (fok) { l("скачан в память: " + t.title + " (" + (f.length() >> 20) + " МБ)"); trim(); } });
      });
    }
  }

  private boolean save(String url, File f) throws Exception {
    File tmp = new File(dir, f.getName() + ".tmp");
    for (int attempt = 0; attempt < 4; attempt++) {
      HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
      c.setConnectTimeout(15000); c.setReadTimeout(30000);
      long have = tmp.exists() ? tmp.length() : 0;
      if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");   // докачка с места обрыва
      try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp, have > 0 && c.getResponseCode() == 206)) {
        byte[] b = new byte[65536]; int r; while ((r = in.read(b)) > 0) out.write(b, 0, r);
        if (tmp.length() > 50_000) return tmp.renameTo(f);
      } catch (Throwable e) { Thread.sleep(3000L * (attempt + 1)); }
      finally { c.disconnect(); }
    }
    tmp.delete(); return false;
  }

  /** На диске держим не больше ~600 МБ музыки: старые треки удаляем. */
  private void trim() {
    File[] fs = dir.listFiles((d, n) -> n.endsWith(".mp3")); if (fs == null) return;
    long total = 0; for (File f : fs) total += f.length();
    if (total < 600L * 1024 * 1024) return;
    Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
    Set<String> keep = new HashSet<>(); if (cur != null) keep.add("m_" + cur.id + ".mp3"); synchronized (queue) { for (Track t : queue) keep.add("m_" + t.id + ".mp3"); for (Track t : userQueue) keep.add("m_" + t.id + ".mp3"); }
    for (File f : fs) { if (total < 450L * 1024 * 1024) break; if (keep.contains(f.getName())) continue; total -= f.length(); f.delete(); new File(dir, f.getName().replace(".mp3", ".json")).delete(); }
  }

  private void writeMeta(Track t) { try { JSONObject o = new JSONObject(); o.put("title", t.title); o.put("artist", t.artist); o.put("cover", t.cover); o.put("albumId", t.albumId);
    try (OutputStream out = new FileOutputStream(new File(dir, "m_" + t.id + ".json"))) { out.write(o.toString().getBytes("UTF-8")); } } catch (Exception ignored) {} }
  private JSONObject readMeta(String id) { try { File f = new File(dir, "m_" + id + ".json"); if (!f.exists()) return null;
    byte[] b = new byte[(int) f.length()]; try (InputStream in = new java.io.FileInputStream(f)) { in.read(b); } return new JSONObject(new String(b, "UTF-8")); } catch (Exception e) { return null; } }

  // ---------- сторож ----------
  private final Runnable watch = new Runnable() { @Override public void run() {
    h.postDelayed(this, 5000);
    if (cur == null || userPaused || !started) { stuckSince = 0; return; }
    long p = player.getCurrentPosition(); long now = System.currentTimeMillis();
    if (player.isPlaying() && p != lastPos) { lastPos = p; stuckSince = 0; return; }
    lastPos = p; if (stuckSince == 0) { stuckSince = now; return; }
    long s = now - stuckSince;
    if (s > 40000) { l("сторож: трек стоит 40 сек — следующий"); stuckSince = 0; next(false); }
    else if (s > 15000 && s < 20500) { l("сторож: трек стоит 15 сек — перезапускаю с того же места"); playTrack(cur, Math.max(0, p)); stuckSince = now - 20500; }
    else if (!player.getPlayWhenReady()) player.play();
  } };

  // ---------- сервер музыки ----------
  private String api(String p) { return worker + p + (p.contains("?") ? "&" : "?") + "k=" + enc(key); }
  private void feedback(final String type, final Track t, final int playedSec) {
    final String b = batch, s = st;
    net.execute(() -> { try {
      JSONObject o = new JSONObject(); o.put("type", type); o.put("batchId", b); o.put("st", s);
      if (t != null) { o.put("trackId", t.id); o.put("albumId", t.albumId == null ? "" : t.albumId); }
      if (playedSec >= 0) o.put("played", playedSec);
      HttpURLConnection c = (HttpURLConnection) new URL(api("/feedback")).openConnection();
      c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestMethod("POST"); c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json");
      try (OutputStream out = c.getOutputStream()) { out.write(o.toString().getBytes("UTF-8")); }
      c.getResponseCode(); c.disconnect();
    } catch (Throwable ignored) {} });
  }
  private static String enc(String s) { try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; } }
  private static String get(String u) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
    c.setConnectTimeout(12000); c.setReadTimeout(20000);
    try (InputStream in = c.getInputStream()) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int r; while ((r = in.read(b)) > 0) bo.write(b, 0, r); return bo.toString("UTF-8"); }
    finally { c.disconnect(); }
  }

  // ---------- журнал ----------
  public void note(String t) { l(t); }
  private void l(String t) { synchronized (log) { log.add(new SimpleDateFormat("HH:mm:ss", Locale.US).format(new java.util.Date()) + "  " + t); if (log.size() > 80) log.removeFirst(); } }
  public String journal() {
    StringBuilder b = new StringBuilder();
    b.append("сейчас: ").append(cur == null ? "нет трека" : cur.artist + " — " + cur.title)
     .append(" | ").append(userPaused ? "пауза кнопкой" : player.isPlaying() ? "играет" : "НЕ играет")
     .append(" | ").append(player.getCurrentPosition() / 1000).append("/").append(Math.max(0, player.getDuration() / 1000)).append(" сек")
     .append(" | в очереди ").append(queueSize()).append(offline ? " | БЕЗ ИНТЕРНЕТА" : "");
    File[] fs = dir.listFiles((d, n) -> n.endsWith(".mp3")); long total = 0; if (fs != null) for (File f : fs) total += f.length();
    b.append(" | треков в памяти ").append(fs == null ? 0 : fs.length).append(" (").append(total >> 20).append(" МБ)\n");
    synchronized (log) { List<String> c = new ArrayList<>(log); Collections.reverse(c); for (int i = 0; i < Math.min(22, c.size()); i++) b.append(c.get(i)).append('\n'); }
    return b.toString();
  }

  public void release() { h.removeCallbacks(watch); net.shutdownNow(); dl.shutdownNow(); player.release(); }
}
