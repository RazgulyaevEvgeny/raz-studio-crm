package kz.raz.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Outline;
import android.graphics.SurfaceTexture;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.exoplayer.ExoPlayer;
import android.content.ComponentCallbacks2;
import android.webkit.RenderProcessGoneDetail;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.animation.PropertyValuesHolder;
import android.graphics.drawable.GradientDrawable;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.BufferedOutputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * «Студия» — экран для ТВ-приставки.
 * Страница экрана работает за кадром (музыка, данные из CRM, вёрстка) и отдаёт готовые слои-картинки:
 * фон, шапку и каждую карточку. Показывает и двигает их сама система Android, а видео играет
 * аппаратный плеер приставки — как в обычных видеоприложениях. Браузер в анимации не участвует.
 */
public class MainActivity extends Activity {
  static final String PAGE = "https://razgulyaevevgeny.github.io/raz-studio-crm/tv.html?app=2";

  private final Handler h = new Handler(Looper.getMainLooper());
  private WebView web;
  private ImageView bgV, chromeV;
  private FrameLayout cardsV;
  private TextView status;
  private View prog;
  private long slideAt, slideMs;
  private ObjectAnimator bgAnim;
  private Bitmap scratch;
  private long backAt;

  private int count = 0, cur = -1;
  private boolean due = true, started = false;
  private Scene pending, building;
  private final List<Vid> vids = new ArrayList<>();
  private final Set<String> loading = new HashSet<>();
  private final Map<String, Integer> tries = new HashMap<>();
  /** Готовые экраны: снимаем страницу один раз и дальше показываем из памяти — снимок тормозил видео. */
  private final Map<Integer, Scene> cache = new HashMap<>();
  /** Ролики качаются по одному в фоне, чтобы не забивать память и сеть. */
  private final ExecutorService dl = Executors.newSingleThreadExecutor();
  private Music music;
  private Updater updater;
  private FrameLayout root;
  private int want = -1;                 // какой экран ждём от страницы для показа
  private long pong = 0, chromeAt = 0;   // последний ответ страницы; последняя съёмка шапки
  private boolean chromeQueued;

  static class Card { boolean kb, tr; int x, y, w, hh, rad, idx; Bitmap a, b; String vid, vurl; int vx, vy, vw, vh; }
  static class Scene { boolean live; int i; double sec = 20; String anim = "spring", tanim = "fade"; int shift = 40; List<Card> cards = new ArrayList<>(); }

  private final Runnable fire = () -> { due = true; if (pending != null) showPending(); };
  private final Runnable askNext = () -> { if (count <= 1) return; int n = (cur + 1) % count; Scene c = cache.get(n); if (c != null && !c.live) ready(c); else { want = n;   // экраны с виджетами (погода, часы, трек) снимаем свежими каждый раз
 js("razScene(" + n + ")"); } };
  /** Сторож показа: если следующий экран не готов вовремя (страница задумалась) — показываем готовый из памяти. Слайды не встают никогда. */
  private final Runnable guard = new Runnable() { @Override public void run() {
    h.postDelayed(this, 4000);
    if (!started || count <= 1 || cache.isEmpty()) return;
    long late = System.currentTimeMillis() - slideAt - slideMs;
    if (late < 6000) return;
    Scene c = null; for (int k = 1; k <= count && c == null; k++) c = cache.get((cur + k) % count);
    if (c != null) { want = -1; pending = null; due = true; ready(c); }
  } };
  /** Сторож страницы: раз в 15 сек проверяем, что движок страницы отвечает; завис на минуту — пересоздаём его, слайды при этом идут из памяти. */
  private final Runnable ping = new Runnable() { @Override public void run() {
    h.postDelayed(this, 15000);
    if (web == null) return;
    try { web.evaluateJavascript("1", v -> pong = System.currentTimeMillis()); } catch (Exception ignored) {}
    if (pong > 0 && System.currentTimeMillis() - pong > 60000) { pong = System.currentTimeMillis(); rebuildWeb(); }
  } };
  private final Runnable chromeShot = () -> { chromeQueued = false; if (cur >= 0) { chromeAt = System.currentTimeMillis(); js("razChrome(" + cur + ")"); } };
  private final Runnable reload = () -> web.loadUrl(PAGE);

  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    makeWeb();


    bgV = new ImageView(this); bgV.setScaleType(ImageView.ScaleType.FIT_XY); bgV.setBackgroundColor(Color.BLACK);
    root.addView(bgV, new FrameLayout.LayoutParams(-1, -1));
    // фон чуть больше экрана и очень медленно плывёт — один слой, приставке это ничего не стоит
    bgV.setScaleX(1.12f); bgV.setScaleY(1.12f);
    bgAnim = ObjectAnimator.ofPropertyValuesHolder(bgV, PropertyValuesHolder.ofFloat(View.TRANSLATION_X, -40f, 40f), PropertyValuesHolder.ofFloat(View.TRANSLATION_Y, 22f, -22f), PropertyValuesHolder.ofFloat(View.SCALE_X, 1.12f, 1.18f), PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.12f, 1.18f));
    bgAnim.setDuration(36000); bgAnim.setRepeatCount(ValueAnimator.INFINITE); bgAnim.setRepeatMode(ValueAnimator.REVERSE); bgAnim.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
    bgAnim.start();
    cardsV = new FrameLayout(this);
    root.addView(cardsV, new FrameLayout.LayoutParams(-1, -1));
    chromeV = new ImageView(this); chromeV.setScaleType(ImageView.ScaleType.FIT_XY);
    root.addView(chromeV, new FrameLayout.LayoutParams(-1, -1));

    prog = new View(this); prog.setVisibility(View.GONE); prog.setPivotX(0);
    root.addView(prog, new FrameLayout.LayoutParams(1, 1));
    status = new TextView(this);
    status.setTextColor(0xFFEBEBF5); status.setTextSize(22); status.setGravity(Gravity.CENTER);
    status.setBackgroundColor(Color.BLACK); status.setPadding(60, 60, 60, 60);
    root.addView(status, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);
    say("Студия запускается…");
    h.postDelayed(() -> { if (!started) say("Экран долго не загружается.\nНажмите ↑ на пульте три раза подряд — откроется окно с кнопкой «Перезагрузить»."); }, 60000);
    web.loadUrl(PAGE);
    music = new Music(this, new Music.Ui() {
      @Override public void now(JSONObject t, String how) { js("window.razNow&&razNow(" + t.toString() + ")"); }
      @Override public void js(String code) { MainActivity.this.js(code); }
    });
    pong = System.currentTimeMillis();
    h.postDelayed(guard, 4000); h.postDelayed(ping, 15000);
    updater = new Updater(this, t -> { if (music != null) music.note(t); }, this::banner); updater.start();
    try {   // после обновления по воздуху — показать, что новая версия встала
      android.content.SharedPreferences sp = getSharedPreferences("app", MODE_PRIVATE); int was = sp.getInt("ver", 0);
      if (was != 0 && was < BuildConfig.VERSION_CODE) h.postDelayed(() -> banner("Обновлено до версии " + BuildConfig.VERSION_NAME + " ✓", -1, 12000), 4000);
      sp.edit().putInt("ver", BuildConfig.VERSION_CODE).apply();
    } catch (Exception ignored) {}
    askAutostart();
  }

  /** Движок страницы (WebView): готовит картинки слоёв и данные. В показе не участвует. */
  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  private void makeWeb() {
    web = new WebView(this);
    web.setBackgroundColor(Color.TRANSPARENT);
    web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);   // страница только готовит картинки; рисовать её видеокартой не нужно
    web.setFocusable(false);
    WebSettings ws = web.getSettings();
    ws.setJavaScriptEnabled(true);
    ws.setDomStorageEnabled(true);
    ws.setDatabaseEnabled(true);
    ws.setMediaPlaybackRequiresUserGesture(false);       // музыка без нажатия кнопки
    ws.setLoadWithOverviewMode(false);
    ws.setUseWideViewPort(false);
    web.addJavascriptInterface(new Bridge(), "RazApp");
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
        // движок страницы упал (обычно не хватило памяти) — музыка бы замолчала; перезапускаем экран целиком
        h.post(() -> rebuildWeb());   // слайды продолжают идти из памяти, пока страница перезапускается
        return true;
      }
      @Override public void onReceivedError(WebView v, WebResourceRequest rq, WebResourceError er) {
        if (rq != null && rq.isForMainFrame() && !started) {
          say("Не удалось загрузить экран. Проверьте интернет.\nПробую снова через 10 секунд.");
          h.removeCallbacks(reload); h.postDelayed(reload, 10000);
        }
      }
    });
    root.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
  }

  private void rebuildWeb() {
    try { root.removeView(web); web.destroy(); } catch (Exception ignored) {}
    makeWeb(); web.loadUrl(PAGE);
  }

  private TextView logV;
  private final Runnable hideLog = () -> { if (logV != null) logV.setVisibility(View.GONE); };
  /** Журнал музыки поверх экрана (кнопка ↑, скрыть — ↓). По нему видно, почему пропадал звук. */
  private void showLog() {
    if (logV == null) {
      logV = new TextView(this); logV.setTextColor(Color.WHITE); logV.setTextSize(12); logV.setPadding(28, 22, 28, 22);
      GradientDrawable g = new GradientDrawable(); g.setColor(0xE6000000); g.setCornerRadius(24); logV.setBackground(g);
      FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.LEFT); lp.leftMargin = 40; lp.topMargin = 40; lp.rightMargin = 40;
      ((FrameLayout) web.getParent()).addView(logV, lp);
    }
    Runtime rt = Runtime.getRuntime();
    android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
    try { ((android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE)).getMemoryInfo(mi); } catch (Exception ignored) {}
    String t = "СТУДИЯ " + BuildConfig.VERSION_NAME + " — журнал (↓ скрыть · ↑↑↑ — обновления)\nпамять приложения " + ((rt.totalMemory() - rt.freeMemory()) >> 20) + " из " + (rt.maxMemory() >> 20) + " МБ · свободно в приставке " + (mi.availMem >> 20) + " из " + (mi.totalMem >> 20) + " МБ"
      + " · экранов готово " + cache.size() + " из " + count + " · видео на экране " + vids.size() + ", из них идёт " + playing() + " · видео в памяти " + vidFiles() + (loading.isEmpty() ? "" : ", качается ещё " + loading.size()) + "\n" + (music != null ? music.journal() : "");
    logV.setText(t); logV.setVisibility(View.VISIBLE); logV.bringToFront();
    h.removeCallbacks(hideLog); h.postDelayed(hideLog, 30000);
  }

  // ——— плашка обновления внизу экрана ———
  private LinearLayout banV; private TextView banT; private ProgressBar banP;
  private final Runnable hideBan = () -> { if (banV != null) banV.setVisibility(View.GONE); };
  void banner(String t, int pct, long hideMs) {
    if (banV == null) {
      banV = new LinearLayout(this); banV.setOrientation(LinearLayout.VERTICAL); banV.setPadding(36, 22, 36, 24);
      GradientDrawable g = new GradientDrawable(); g.setColor(0xEE101018); g.setCornerRadius(28); g.setStroke(2, 0x40FFFFFF); banV.setBackground(g);
      banT = new TextView(this); banT.setTextColor(Color.WHITE); banT.setTextSize(18); banV.addView(banT);
      banP = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); banP.setMax(100);
      LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(-1, 14); pl.topMargin = 14; banV.addView(banP, pl);
      FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL); lp.bottomMargin = 48; lp.leftMargin = 60; lp.rightMargin = 60;
      root.addView(banV, lp);
    }
    banT.setText("⟳ " + t);
    banP.setVisibility(pct >= 0 ? View.VISIBLE : View.GONE); if (pct >= 0) banP.setProgress(pct);
    banV.setVisibility(View.VISIBLE); banV.bringToFront();
    h.removeCallbacks(hideBan); if (hideMs > 0) h.postDelayed(hideBan, hideMs);
    if (updV != null && updV.getVisibility() == View.VISIBLE) fillUpdates();
  }

  // ——— окно «Обновления»: ↑ три раза подряд; кнопки — стрелками и OK, «Назад» — закрыть ———
  private LinearLayout updV; private TextView updInfo; private long upAt; private int upN;
  private TextView btn(String t, View.OnClickListener l) {
    TextView b = new TextView(this); b.setText(t); b.setTextSize(18); b.setTextColor(Color.WHITE); b.setPadding(34, 18, 34, 18); b.setGravity(Gravity.CENTER);
    android.graphics.drawable.StateListDrawable st = new android.graphics.drawable.StateListDrawable();
    GradientDrawable on = new GradientDrawable(); on.setColor(0xFFFF5A1F); on.setCornerRadius(18);
    GradientDrawable off = new GradientDrawable(); off.setColor(0x33FFFFFF); off.setCornerRadius(18);
    st.addState(new int[]{ android.R.attr.state_focused }, on); st.addState(new int[]{}, off); b.setBackground(st);
    b.setFocusable(true); b.setClickable(true); b.setOnClickListener(l); return b;
  }
  private void openUpdates() {
    if (logV != null) logV.setVisibility(View.GONE);
    if (updV == null) {
      updV = new LinearLayout(this); updV.setOrientation(LinearLayout.VERTICAL); updV.setPadding(48, 40, 48, 40);
      GradientDrawable g = new GradientDrawable(); g.setColor(0xF2101018); g.setCornerRadius(32); g.setStroke(2, 0x40FFFFFF); updV.setBackground(g);
      TextView t = new TextView(this); t.setText("Обновления"); t.setTextColor(Color.WHITE); t.setTextSize(28); t.setTypeface(null, android.graphics.Typeface.BOLD); updV.addView(t);
      updInfo = new TextView(this); updInfo.setTextColor(0xFFDADAE6); updInfo.setTextSize(16); updInfo.setLineSpacing(6, 1f);
      LinearLayout.LayoutParams il = new LinearLayout.LayoutParams(-1, -2); il.topMargin = 18; il.bottomMargin = 26; updV.addView(updInfo, il);
      LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
      TextView b1 = btn("Проверить и установить", v -> { updater.check(true); fillUpdates(); });
      TextView b2 = btn("Перезагрузить экран", v -> { closeUpdates(); started = false; say("Перезагружаю…"); web.reload(); });
      TextView b3 = btn("Закрыть", v -> closeUpdates());
      LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(-2, -2); bl.rightMargin = 18;
      row.addView(b1, bl); row.addView(b2, new LinearLayout.LayoutParams(bl)); row.addView(b3, new LinearLayout.LayoutParams(bl));
      updV.addView(row);
      TextView hint = new TextView(this); hint.setText("←  →  выбрать · OK — нажать · «Назад» — закрыть"); hint.setTextColor(0x99FFFFFF); hint.setTextSize(14);
      LinearLayout.LayoutParams hl = new LinearLayout.LayoutParams(-2, -2); hl.topMargin = 20; updV.addView(hint, hl);
      root.addView(updV, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
    }
    fillUpdates(); updV.setVisibility(View.VISIBLE); updV.bringToFront();
    if (banV != null) banV.bringToFront();
    ((LinearLayout) updV.getChildAt(2)).getChildAt(0).requestFocus();
    if (!updater.busy() && updater.list.isEmpty()) updater.check(false);   // подтянуть список версий
  }
  private void fillUpdates() {
    StringBuilder b = new StringBuilder("Установлена версия " + BuildConfig.VERSION_NAME + "\nСостояние: " + updater.state + "\n\nВерсии:\n");
    synchronized (updater.list) {
      if (updater.list.isEmpty()) b.append("  загружаю список…\n");
      int n = 0; for (String[] r : updater.list) { if (n++ >= 6) break; int code = Integer.parseInt(r[0]);
        b.append(code == BuildConfig.VERSION_CODE ? "  ✓ " : code > BuildConfig.VERSION_CODE ? "  ★ " : "     ").append(r[1]).append("   ").append(r[2])
         .append(code == BuildConfig.VERSION_CODE ? "   — стоит сейчас" : code > BuildConfig.VERSION_CODE ? "   — новая" : "").append("\n"); }
    }
    updInfo.setText(b.toString());
  }
  private void closeUpdates() { if (updV != null) updV.setVisibility(View.GONE); }
  private boolean updOpen() { return updV != null && updV.getVisibility() == View.VISIBLE; }

  private void say(String t) { status.setText(t); status.setVisibility(t.isEmpty() ? View.GONE : View.VISIBLE); }
  private void js(String code) { try { web.evaluateJavascript("try{" + code + "}catch(e){}", null); } catch (Exception ignored) {} }

  /** Мост: страница сообщает, что слой готов к съёмке. */
  class Bridge {
    @JavascriptInterface public void built(String json) { h.post(() -> onBuilt(json)); }
    @JavascriptInterface public void shot(String kind, String json) { h.post(() -> { try { onShot(kind, json); } catch (Throwable t) { /* слой пропустим */ } js("window.razAck&&razAck()"); }); }
    @JavascriptInterface public void chromeChanged() { h.post(() -> {   // шапку переснимаем не чаще раза в 8 сек — съёмка нагружает приставку
      if (cur < 0 || chromeQueued) return; long w = 8000 - (System.currentTimeMillis() - chromeAt);
      chromeQueued = true; h.postDelayed(chromeShot, Math.max(0, w)); }); }
    @JavascriptInterface public void music(String json) { h.post(() -> { try { if (music != null) { music.settings(new JSONObject(json)); music.announce(); } } catch (Exception ignored) {} }); }
  }

  private void onBuilt(String json) {
    JSONArray vl = null;
    try { JSONObject o = new JSONObject(json); count = o.optInt("n", 0); vl = o.optJSONArray("videos"); } catch (Exception e) { count = 0; }
    cache.clear();
    if (vl != null) {   // заранее качаем все ролики в память приставки, лишние удаляем
      Set<String> keep = new HashSet<>();
      for (int k = 0; k < vl.length(); k++) { JSONObject v = vl.optJSONObject(k); if (v == null) continue; String id = v.optString("id"); keep.add("v_" + id + ".mp4"); }
      File[] fs = getFilesDir().listFiles();
      if (fs != null) for (File f : fs) { String nm = f.getName(); if (nm.startsWith("v_") && (nm.endsWith(".mp4") || nm.endsWith(".tmp"))) {
        String id = nm.substring(2, nm.length() - 4);
        if (loading.contains(id)) continue;   // ролик сейчас качается — не трогаем (раньше каждое обновление экрана стирало недокачанный файл, и видео не появлялись)
        if (nm.endsWith(".tmp") || !keep.contains(nm)) f.delete(); } }
      for (int k = 0; k < vl.length(); k++) { JSONObject v = vl.optJSONObject(k); if (v != null) fetchVideo(v.optString("id"), v.optString("url")); }
    }
    h.removeCallbacks(fire); h.removeCallbacks(askNext);
    pending = null; building = null; due = true; cur = -1;
    want = 0; chromeAt = System.currentTimeMillis();
    if (count > 0) js("razBg();razChrome(0);razScene(0)");
  }

  private Bitmap grab() { return grab(null); }
  /** Снимок страницы. clip — рисуем только эти полосы (шапка и низ): так съёмка в разы быстрее. */
  private Bitmap grab(int[][] clip) {
    int w = web.getWidth(), hh = web.getHeight();
    if (w <= 0 || hh <= 0) return null;
    if (scratch == null || scratch.getWidth() != w || scratch.getHeight() != hh) scratch = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
    scratch.eraseColor(Color.TRANSPARENT);
    if (clip == null) { web.draw(new Canvas(scratch)); return scratch; }
    for (int[] r : clip) { if (r == null || r[3] <= r[1]) continue; Canvas cv = new Canvas(scratch); cv.clipRect(0, Math.max(0, r[1]), w, Math.min(hh, r[3])); web.draw(cv); }
    return scratch;
  }
  private Bitmap opaque(Bitmap b) {   // фон карточки без прозрачности — в 2 раза меньше памяти
    return b; }   // карточки храним в полном цвете (32 бита): 16-битное сжатие давало полосы и рябь на заливках

  private Bitmap crop(Bitmap src, int x, int y, int w, int hh) {
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(w, src.getWidth() - x); hh = Math.min(hh, src.getHeight() - y);
    if (w <= 0 || hh <= 0) return null;
    return Bitmap.createBitmap(src, x, y, w, hh);
  }

  private void onShot(String kind, String json) throws Exception {
    int[][] clip = null;
    if ("chrome".equals(kind)) try { JSONObject o = new JSONObject(json); JSONArray hd = o.optJSONArray("hd"), ft = o.optJSONArray("ft");
      if (hd != null && ft != null) clip = new int[][] { { 0, 0, 0, hd.getInt(1) + hd.getInt(3) + 8 }, { 0, ft.getInt(1) - 8, 0, ft.getInt(1) + ft.getInt(3) + 8 } }; } catch (Exception ignored) {}
    Bitmap s = grab(clip);
    if (s == null) return;
    if ("bg".equals(kind)) { bgV.setImageBitmap(s.copy(Bitmap.Config.ARGB_8888, false)); return; }
    if ("chrome".equals(kind)) {
      chromeV.setImageBitmap(s.copy(Bitmap.Config.ARGB_8888, false));
      try { JSONObject o = new JSONObject(json); JSONArray d = o.optJSONArray("dot"); if (d != null) placeProgress(d.getInt(0), d.getInt(1), d.getInt(2), d.getInt(3), o.optBoolean("dark", true)); } catch (Exception ignored) {}
      return;
    }
    if ("scene".equals(kind)) {
      JSONObject o = new JSONObject(json);
      Scene sc = new Scene();
      sc.i = o.optInt("i"); sc.live = o.optBoolean("live", false); sc.sec = o.optDouble("sec", 20); sc.anim = o.optString("anim", "spring"); sc.tanim = o.optString("tanim", "fade"); sc.shift = o.optInt("shift", 40);
      JSONArray cs = o.getJSONArray("cards");
      boolean hasVid = false;
      for (int k = 0; k < cs.length(); k++) {
        JSONObject c = cs.getJSONObject(k); JSONArray r = c.getJSONArray("r");
        Card cd = new Card();
        cd.x = r.getInt(0); cd.y = r.getInt(1); cd.w = r.getInt(2); cd.hh = r.getInt(3); cd.rad = c.optInt("rad", 0); cd.kb = c.optBoolean("kb", false); cd.tr = c.optBoolean("tr", false); cd.idx = c.optInt("i", k);
        // заголовок экрана прозрачный — его нельзя сжимать без прозрачности, иначе он получает чёрный фон
        cd.a = cd.tr ? crop(s, cd.x, cd.y, cd.w, cd.hh) : opaque(crop(s, cd.x, cd.y, cd.w, cd.hh));
        JSONObject v = c.optJSONObject("v");
        if (v != null) { JSONArray vr = v.getJSONArray("r"); cd.vid = v.getString("id"); cd.vurl = v.getString("url");
          cd.vx = vr.getInt(0); cd.vy = vr.getInt(1); cd.vw = vr.getInt(2); cd.vh = vr.getInt(3); hasVid = true; fetchVideo(cd.vid, cd.vurl); }
        if (cd.a != null) sc.cards.add(cd);
      }
      building = sc;   // следом придёт слой текста
      return;
    }
    if ("over".equals(kind) && building != null) {
      for (Card cd : building.cards) cd.b = crop(s, cd.x, cd.y, cd.w, cd.hh);
      Scene sc = building; building = null; cache.put(sc.i, sc); trimCache();
      if (sc.i == want || cur < 0) { want = -1; ready(sc); }
      h.removeCallbacks(prerender); h.postDelayed(prerender, 2500);
    }
  }

  /** Полоска прогресса текущего слайда: заполняется за время показа. */
  private void placeProgress(int x, int y, int w, int hh, boolean dark) {
    if (w <= 0 || hh <= 0) { prog.setVisibility(View.GONE); return; }
    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) prog.getLayoutParams();
    lp.width = w; lp.height = hh; lp.leftMargin = x; lp.topMargin = y; prog.setLayoutParams(lp);
    GradientDrawable g = new GradientDrawable(); g.setColor(dark ? Color.WHITE : 0xFF007AFF); g.setCornerRadius(hh / 2f); prog.setBackground(g);
    prog.setVisibility(count > 1 ? View.VISIBLE : View.GONE);
    prog.animate().cancel();
    long left = slideMs - (System.currentTimeMillis() - slideAt);
    float done = slideMs > 0 ? Math.max(0f, Math.min(1f, 1f - left / (float) slideMs)) : 1f;
    prog.setScaleX(done);
    if (left > 0) prog.animate().scaleX(1f).setDuration(left).setInterpolator(new LinearInterpolator()).start();
  }

  /** Остальные экраны готовим заранее, по одному, пока идёт показ — дальше всё крутится из памяти. */
  private final Runnable prerender = () -> {
    if (count <= 1 || building != null) return;
    if (cur < 0) return;
    for (int k = 1; k <= 2 && k < count; k++) { int n = (cur + k) % count; if (!cache.containsKey(n) && n != want) { js("razScene(" + n + ")"); return; } }
  };
  /** В памяти держим только текущий и 2 следующих экрана: 9 экранов в полном цвете съедали память,
   *  и приставке не хватало её на декодер видео — ролики стояли кадром. */
  private void trimCache() {
    if (cur < 0 || count <= 3) return;
    Set<Integer> keep = new HashSet<>(); keep.add(cur); keep.add((cur + 1) % count); keep.add((cur + 2) % count); if (want >= 0) keep.add(want);
    cache.keySet().retainAll(keep);
  }

  private void ready(Scene sc) { pending = sc; if (due) showPending(); }

  private void showPending() {
    final Scene sc = pending; pending = null; due = false;
    if (!started) { started = true; say(""); }
    cur = sc.i; trimCache();
    slideAt = System.currentTimeMillis(); slideMs = (long) (Math.max(5, sc.sec) * 1000);
    prog.animate().cancel(); prog.setScaleX(0f);
    transition(sc);
    js("razChrome(" + cur + ")");
    h.removeCallbacks(fire); h.removeCallbacks(askNext);
    if (count > 1) { h.postDelayed(askNext, 2500); h.postDelayed(fire, (long) (Math.max(5, sc.sec) * 1000)); }
  }

  /** Смена экрана: старые карточки гаснут, новые выезжают по очереди. Двигаются готовые картинки — это дёшево для любой приставки. */
  private void transition(final Scene sc) {
    final List<View> old = new ArrayList<>();
    for (int k = 0; k < cardsV.getChildCount(); k++) old.add(cardsV.getChildAt(k));
    final List<Vid> oldVids = new ArrayList<>(vids); vids.clear();
    int n = 0;
    for (final View v : old) v.animate().alpha(0f).translationY(-sc.shift * 0.6f).scaleX(0.97f).scaleY(0.97f)
        .setDuration(260).setStartDelay(40L * n++).setInterpolator(new AccelerateInterpolator(1.4f)).withEndAction(() -> cardsV.removeView(v)).start();
    for (Vid v : oldVids) v.release();   // декодеров у приставки мало: освобождаем до запуска новых (последний кадр остаётся на экране)
    h.postDelayed(() -> { for (Card c : sc.cards) addCard(sc, c); }, old.isEmpty() ? 0 : 340);
  }

  private void addCard(Scene sc, final Card c) {
    FrameLayout box = new FrameLayout(this);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(c.w, c.hh); lp.leftMargin = c.x; lp.topMargin = c.y;
    final int rad = c.rad;
    box.setOutlineProvider(new ViewOutlineProvider() { @Override public void getOutline(View v, Outline o) { o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), rad); } });
    box.setClipToOutline(true);
    ImageView a = new ImageView(this); a.setScaleType(ImageView.ScaleType.FIT_XY); a.setImageBitmap(c.a);
    box.addView(a, new FrameLayout.LayoutParams(-1, -1));
    if (c.kb) {   // живое фото: фон карточки медленно приближается всё время показа
      a.setScaleX(1.02f); a.setScaleY(1.02f);
      a.animate().scaleX(1.14f).scaleY(1.14f).setDuration(Math.max(6000, slideMs + 1500)).setInterpolator(new LinearInterpolator()).start();
    }
    if (c.vid != null) {
      TextureView tv = new TextureView(this);
      FrameLayout.LayoutParams vp = new FrameLayout.LayoutParams(Math.max(2, c.vw), Math.max(2, c.vh)); vp.leftMargin = c.vx - c.x; vp.topMargin = c.vy - c.y;
      tv.setAlpha(0.01f);
      box.addView(tv, vp);
      vids.add(new Vid(c.vid, tv, 300L + 260L * vids.size()));
    }
    if (c.b != null) {   // слой текста: появляется отдельно, чуть позже карточки
      ImageView bv = new ImageView(this); bv.setScaleType(ImageView.ScaleType.FIT_XY); bv.setImageBitmap(c.b);
      box.addView(bv, new FrameLayout.LayoutParams(-1, -1));
      if (!"none".equals(sc.tanim) && !"none".equals(sc.anim)) {
        bv.setAlpha(0f);
        if ("up".equals(sc.tanim)) bv.setTranslationY(sc.shift * 1.2f);
        else if ("left".equals(sc.tanim)) bv.setTranslationX(-sc.shift * 1.6f);
        else if ("zoom".equals(sc.tanim)) { bv.setScaleX(0.9f); bv.setScaleY(0.9f); }
        bv.animate().alpha(1f).translationX(0).translationY(0).scaleX(1f).scaleY(1f).setDuration(620).setStartDelay(110L * c.idx + 260).setInterpolator(new DecelerateInterpolator(2f)).start();
      }
    }
    float dx = 0, dy = sc.shift * 1.5f, sc0 = 0.94f; long dur = 720; android.animation.TimeInterpolator ip = new OvershootInterpolator(1.15f);
    switch (sc.anim) {
      case "up": ip = new DecelerateInterpolator(2.2f); dy = sc.shift * 2.4f; sc0 = 1f; dur = 640; break;
      case "left": case "flip": dx = -sc.shift * 3f; dy = 0; sc0 = 1f; ip = new DecelerateInterpolator(2.2f); dur = 640; break;
      case "right": dx = sc.shift * 3f; dy = 0; sc0 = 1f; ip = new DecelerateInterpolator(2.2f); dur = 640; break;
      case "drop": dy = -sc.shift * 2.4f; sc0 = 1f; ip = new OvershootInterpolator(1.3f); break;
      case "zoom": dy = 0; sc0 = 0.82f; ip = new OvershootInterpolator(1.2f); break;
      case "fade": dy = 0; sc0 = 1f; ip = new DecelerateInterpolator(1.5f); dur = 600; break;
      case "none": dy = 0; sc0 = 1f; dur = 1; break;
      default: break;   // spring: снизу с лёгкой пружиной
    }
    box.setAlpha(0f); box.setTranslationX(dx); box.setTranslationY(dy); box.setScaleX(sc0); box.setScaleY(sc0);
    cardsV.addView(box, lp);
    final boolean plain = false;   // внутри карточки свои анимации (текст, фото) — общий слой не используем
    if (plain) box.setLayerType(View.LAYER_TYPE_HARDWARE, null);   // на время движения карточка — одна текстура
    final FrameLayout fb = box;
    box.animate().translationX(0).translationY(0).scaleX(1f).scaleY(1f).setDuration(dur).setStartDelay(110L * c.idx).setInterpolator(ip)
        .withEndAction(() -> { if (plain) fb.setLayerType(View.LAYER_TYPE_NONE, null); }).start();
    ObjectAnimator fade = ObjectAnimator.ofFloat(box, View.ALPHA, 0f, 1f); fade.setDuration(Math.min(dur, 380)); fade.setStartDelay(110L * c.idx); fade.setInterpolator(new DecelerateInterpolator()); fade.start();
  }

  /** Видео в карточке: ExoPlayer (тот же движок, что в YouTube для Android) с аппаратным декодером,
   *  по кругу без шва, звуковая дорожка ролика отключена полностью — музыке не мешает. */
  /** Два постоянных плеера на всё время работы. Раньше на каждом экране плеер создавался и уничтожался заново,
   *  и аппаратный декодер приставки не успевал освободиться («Player release timed out») — новые ролики стояли кадром.
   *  Теперь плееры не уничтожаются: на новом экране им просто дают другой ролик и другую картинку. */
  private final ExoPlayer[] pool = new ExoPlayer[2];
  private final Vid[] owner = new Vid[2];
  private int slotErrs[] = new int[2];
  private ExoPlayer player(final int k) {
    if (pool[k] != null) return pool[k];
    ExoPlayer p = new ExoPlayer.Builder(this, new androidx.media3.exoplayer.DefaultRenderersFactory(this).setEnableDecoderFallback(true)).build();
    p.setTrackSelectionParameters(p.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build());
    p.setVolume(0f); p.setRepeatMode(Player.REPEAT_MODE_ONE);
    p.addAnalyticsListener(new androidx.media3.exoplayer.analytics.AnalyticsListener() {
      @Override public void onVideoDecoderInitialized(androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime t, String name, long a1, long a2) { vnote(k, "декодер " + name); }
      @Override public void onDroppedVideoFrames(androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime t, int n, long ms) { vnote(k, "пропущено кадров " + n); }
    });
    p.addListener(new Player.Listener() {
      @Override public void onVideoSizeChanged(VideoSize vs) { Vid v = owner[k]; if (v != null) v.fit(vs.width, vs.height, vs.unappliedRotationDegrees); }
      @Override public void onRenderedFirstFrame() { Vid v = owner[k]; slotErrs[k] = 0; vnote(k, "первый кадр показан ✓"); if (v != null) { v.on = true; v.tv.animate().alpha(1f).setDuration(350).start(); } }
      @Override public void onPlayerError(PlaybackException e) {
        Vid v = owner[k]; owner[k] = null; slotErrs[k]++;
        if (music != null) music.note("видео" + (v != null ? " " + v.id.substring(0, Math.min(6, v.id.length())) : "") + ": ошибка " + e.getErrorCodeName() + (e.getCause() != null ? " — " + e.getCause().getMessage() : ""));
        if (slotErrs[k] >= 3) { final ExoPlayer old = pool[k]; pool[k] = null; slotErrs[k] = 0;   // плеер сломался — заменяем новым, старый гасим в фоне
          h.post(() -> { try { old.release(); } catch (Throwable ignored) {} }); }
        else { try { pool[k].stop(); } catch (Throwable ignored) {} }
        if (v != null) { v.slot = -1; v.errs++; if (!v.dead) v.later(Math.min(15000L, 2000L * v.errs)); }
      }
    });
    return pool[k] = p;
  }

  private void vnote(int k, String t) { Vid v = owner[k]; if (music != null) music.note("видео" + (k + 1) + (v != null ? " " + v.id.substring(0, Math.min(6, v.id.length())) : "") + ": " + t); }

  class Vid {
    final String id; final TextureView tv; int slot = -1; boolean dead, on; int errs;
    Vid(String id, TextureView tv, long delay) { this.id = id; this.tv = tv; later(delay); }
    File file() { return new File(getFilesDir(), "v_" + id + ".mp4"); }
    final Runnable start = this::tryStart;
    void later(long ms) { h.removeCallbacks(start); h.postDelayed(start, ms); }
    void tryStart() {
      if (dead || slot >= 0) return;
      String sid = id.substring(0, Math.min(6, id.length()));
      if (loading.contains(id)) { if (music != null) music.note("видео " + sid + ": ещё качается"); return; }
      if (!file().exists()) { if (music != null) music.note("видео " + sid + ": файла нет в памяти"); return; }
      int k = owner[0] == null ? 0 : owner[1] == null ? 1 : -1;
      if (k < 0) { if (music != null) music.note("видео " + sid + ": оба плеера заняты"); later(2000); return; }   // оба плеера заняты — подождём
      if (music != null) music.note("видео " + sid + ": запускаю в плеере " + (k + 1) + ", файл " + (file().length() >> 10) + " КБ, картинка " + (tv.isAvailable() ? "готова" : "ещё не готова") + " " + tv.getWidth() + "×" + tv.getHeight());
      try {
        ExoPlayer p = player(k); owner[k] = this; slot = k;
        p.setVideoTextureView(tv);
        p.setMediaItem(MediaItem.fromUri(Uri.fromFile(file()))); p.prepare(); p.play();
      } catch (Throwable e) { owner[k] = null; slot = -1; errs++; if (music != null && errs == 1) music.note("видео: не запустилось — " + e); if (!dead) later(Math.min(15000L, 2000L * errs)); }
    }
    void fit(int vw, int vh, int rot) {   // заполнить карточку с обрезкой по центру, с учётом поворота ролика
      int w = tv.getWidth(), hh = tv.getHeight(); if (vw <= 0 || vh <= 0 || w <= 0 || hh <= 0) return;
      Matrix m = new Matrix();
      m.postScale(vw / (float) w, vh / (float) hh); m.postTranslate(-vw / 2f, -vh / 2f); m.postRotate(rot);
      float rw = rot % 180 == 0 ? vw : vh, rh = rot % 180 == 0 ? vh : vw, sc = Math.max(w / rw, hh / rh);
      m.postScale(sc, sc); m.postTranslate(w / 2f, hh / 2f); tv.setTransform(m);
    }
    boolean playing() { return on && slot >= 0; }
    void release() {   // плеер не уничтожаем — останавливаем и отдаём следующему экрану
      dead = true; h.removeCallbacks(start);
      if (slot >= 0 && owner[slot] == this) { ExoPlayer p = pool[slot]; owner[slot] = null;
        if (p != null) try { p.stop(); p.clearVideoTextureView(tv); } catch (Throwable ignored) {} }
      slot = -1;
    }
  }

  /** Скачать ролик в память приставки (один раз). В базе он лежит текстом base64 частями по 6 МБ —
   *  раскодируем по кусочку прямо в файл, не собирая весь ролик в памяти (раньше большие ролики не влезали). */
  private void fetchVideo(final String id, final String url) {
    if (id == null || id.isEmpty() || url == null || url.isEmpty()) return;
    final File f = new File(getFilesDir(), "v_" + id + ".mp4");
    if (f.exists() || loading.contains(id)) return;
    loading.add(id);
    dl.execute(() -> {
      boolean ok = download(id, url, f);
      h.post(() -> {
        loading.remove(id);
        if (ok) { if (music != null) music.note("видео " + id.substring(0, Math.min(6, id.length())) + ": скачано " + (f.length() >> 10) + " КБ"); for (Vid v : vids) if (v.id.equals(id)) v.later(100); return; }
        if (music != null) music.note("видео " + id.substring(0, Math.min(6, id.length())) + ": не скачалось — " + dlErr);
        int t = tries.containsKey(id) ? tries.get(id) + 1 : 1; tries.put(id, t);
        if (t < 8) h.postDelayed(() -> fetchVideo(id, url), 5000L * t);   // сеть моргнула — попробуем ещё
      });
    });
  }

  private int playing() { int n = 0; for (Vid v : vids) if (v.playing()) n++; return n; }
  private int vidFiles() { File[] fs = getFilesDir().listFiles(); int n = 0; if (fs != null) for (File f : fs) if (f.getName().startsWith("v_") && f.getName().endsWith(".mp4")) n++; return n; }

  private volatile String dlErr = "";
  private boolean download(String id, String url, File f) {
    File tmp = new File(getFilesDir(), "v_" + id + ".tmp");
    try (OutputStream out = new BufferedOutputStream(new FileOutputStream(tmp), 1 << 16)) {
      JSONObject o = new JSONObject(http(url + ".json"));
      String d0 = o.optString("d", ""); int n = Math.max(1, o.optInt("n", 1)); o = null;
      StringBuilder carry = new StringBuilder();
      feed(out, carry, d0.substring(d0.indexOf(',') + 1)); d0 = null;
      for (int k = 1; k < n; k++) feed(out, carry, (String) new JSONTokener(http(url + "_p" + k + "/d.json")).nextValue());
      if (carry.length() > 0) out.write(Base64.decode(carry.toString(), Base64.DEFAULT));
    } catch (Throwable e) { tmp.delete(); dlErr = String.valueOf(e); return false; }
    if (tmp.length() < 1000) { tmp.delete(); dlErr = "пустой файл"; return false; }
    return tmp.renameTo(f);
  }

  /** Раскодировать кусок base64 порциями по ~1 МБ; хвост, не кратный 4 символам, переносим в следующий кусок. */
  private static void feed(OutputStream out, StringBuilder carry, String part) throws Exception {
    carry.append(part);
    int usable = carry.length() - carry.length() % 4, pos = 0;
    while (pos < usable) { int end = Math.min(usable, pos + (1 << 20)); out.write(Base64.decode(carry.substring(pos, end), Base64.DEFAULT)); pos = end; }
    carry.delete(0, usable);
  }

  private static String http(String u) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
    c.setConnectTimeout(15000); c.setReadTimeout(60000);
    try (InputStream in = c.getInputStream()) {
      ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[65536]; int r;
      while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
      return bo.toString("UTF-8");
    } finally { c.disconnect(); }
  }

  /** Android 10+ пускает автозапуск после включения только с разрешением «поверх других приложений». */
  private void askAutostart() {
    try { if (!Settings.canDrawOverlays(this)) startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
  }

  @Override public boolean dispatchKeyEvent(KeyEvent e) {
    int k = e.getKeyCode(); boolean up = e.getAction() == KeyEvent.ACTION_UP;
    if (updOpen()) {   // открыто окно обновлений: кнопки работают как обычно, «Назад» закрывает
      if (k == KeyEvent.KEYCODE_BACK) { if (up) closeUpdates(); return true; }
      if (k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_DPAD_DOWN) return true;
      return super.dispatchKeyEvent(e);
    }
    if (k == KeyEvent.KEYCODE_BACK) {
      if (up) { long now = System.currentTimeMillis(); if (now - backAt < 2000) finish(); else { backAt = now; Toast.makeText(this, "Нажмите «Назад» ещё раз, чтобы выйти", Toast.LENGTH_SHORT).show(); } }
      return true;
    }
    if (k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_INFO || k == KeyEvent.KEYCODE_GUIDE) {
      if (up) { long now = System.currentTimeMillis(); upN = now - upAt < 900 ? upN + 1 : 1; upAt = now;
        if (upN >= 3) { upN = 0; openUpdates(); } else showLog(); }
      return true;
    }
    if (k == KeyEvent.KEYCODE_DPAD_DOWN) { if (up && logV != null) logV.setVisibility(View.GONE); return true; }
    if (k == KeyEvent.KEYCODE_MENU) { if (up) openUpdates(); return true; }
    if (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER
        || k == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || k == KeyEvent.KEYCODE_MEDIA_PLAY || k == KeyEvent.KEYCODE_MEDIA_PAUSE || k == KeyEvent.KEYCODE_SPACE) {
      if (up && music != null) { String r = music.togglePause();
        Toast.makeText(this, "pause".equals(r) ? "Музыка на паузе" : "play".equals(r) ? "Музыка играет" : "Музыка ещё не запущена", Toast.LENGTH_SHORT).show(); }
      return true;
    }
    if (k == KeyEvent.KEYCODE_DPAD_RIGHT || k == KeyEvent.KEYCODE_MEDIA_NEXT) { if (up && music != null) { music.nextTrack(); Toast.makeText(this, "Следующий трек", Toast.LENGTH_SHORT).show(); } return true; }
    if (k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_MEDIA_PREVIOUS) { if (up && music != null) { music.prevTrack(); Toast.makeText(this, "Предыдущий трек", Toast.LENGTH_SHORT).show(); } return true; }
    return super.dispatchKeyEvent(e);
  }

  @Override public void onTrimMemory(int level) {   // система просит память — отдаём готовые экраны (кроме текущего), они пересоберутся
    super.onTrimMemory(level);
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) { Scene c = cache.get(cur); cache.clear(); if (c != null) cache.put(cur, c); }
  }

  @Override protected void onDestroy() { if (updater != null) updater.stop(); if (music != null) music.release(); h.removeCallbacksAndMessages(null); for (Vid v : vids) v.release(); for (ExoPlayer p : pool) if (p != null) try { p.release(); } catch (Throwable ignored) {} dl.shutdownNow(); try { web.destroy(); } catch (Exception ignored) {} super.onDestroy(); }

  @Override public void onWindowFocusChanged(boolean f) {
    super.onWindowFocusChanged(f);
    if (f) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }
}
