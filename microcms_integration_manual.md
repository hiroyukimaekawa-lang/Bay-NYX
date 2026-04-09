# microCMS動的化 導入マニュアル

このマニュアルは、静的なHTMLサイト（例：Bay NYX）に対して、microCMSを利用して特定のセクション（期間限定キャスト）の情報を動的に更新・反映させるための手順をまとめたものです。

---

## 1. 事前準備（microCMS側の設定確認）

実装を始める前に、microCMSの管理画面から以下の3つの情報を確認・取得します。

- **サービスドメイン**: `https://[ここ].microcms.io/` の `[ここ]` の部分（例: `l9pawk28o1`）
  > [!WARNING]
  > サービスドメインの先頭の文字がアルファベットの小文字「`l`（エル）」なのか、「`i`（アイ）」なのかなど、1文字違うだけでも通信エラーとなります。完全に一致しているか必ず確認してください。
- **エンドポイント**: APIを取得する対象のパス（例: `baynyx`）
- **APIキー (X-MICROCMS-API-KEY)**: APIにアクセスするためのシークレットキーを必ず取得してください。

---

## 2. HTMLファイルの修正（表示領域の空化）

もともと静的（手打ち）で記述されていた要素を削除し、JavaScriptのプログラムがデータを流し込むための「空の箱」を用意します。

### 対象ファイル: `index.html`
対象のID（例：`#specialGuestGrid`）の内部にある静的な `<article>` などの要素をすべて削除します。

**変更前（静的だった状態）：**
```html
<div id="specialGuestGrid" class="cast-grid fade" style="display: none; margin-top: 32px;">
  <article class="cast-item" tabindex="0">
    <!-- 静的なコンテンツがたくさん書いてある -->
  </article>
  <!-- ...その他のカード... -->
</div>
```

**変更後（空の状態）：**
```html
<div id="specialGuestGrid" class="cast-grid fade" style="display: none; margin-top: 32px;">
  <!-- JavaScriptによって動的にここへ追加されます -->
</div>
```

---

## 3. JavaScript機能の追加（API非同期通信）

HTMLファイル内に読み込まれているJavaScriptの末尾（全てのタグの最後、`</body>` の直前など）に、microCMSからデータを取得してHTMLを生成する処理を追加します。

### 対象ファイル: 基本的に `index.html` の末尾

以下のコードを追加し、最上部の `MICROCMS_API_KEY` などを実際の値に書き換えます。

```javascript
// --- microCMSからの期間限定キャストデータ取得 ---
const MICROCMS_API_KEY = '実際のAPIキーをここに入力';
const MICROCMS_SERVICE_DOMAIN = 'l9pawk28o1'; // 正しいサービスドメイン
const MICROCMS_ENDPOINT = 'baynyx'; // エンドポイント

// APIからデータを取得する非同期関数
async function fetchSpecialGuests() {
  try {
    const response = await fetch(`https://${MICROCMS_SERVICE_DOMAIN}.microcms.io/api/v1/${MICROCMS_ENDPOINT}`, {
      headers: {
        'X-MICROCMS-API-KEY': MICROCMS_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`microCMS API Error: ${response.status}`);
    }

    const data = await response.json();
    renderSpecialGuests(data.contents); // 取得成功したら描画用関数へデータを渡す
  } catch (error) {
    console.error('期間限定キャストの取得に失敗しました:', error);
  }
}

// 取得したデータをHTMLに変換して流し込む関数
function renderSpecialGuests(guests) {
  const grid = document.getElementById('specialGuestGrid');
  if (!grid) return;

  grid.innerHTML = ''; // 中身を一度クリア

  guests.forEach((guest, index) => {
    // 既存のHTML構造とCSSクラスをそのまま利用して動的に組み立てる
    const rankNumber = 5 + index; // カウント
    const rankSymbol = '♥';

    // 画像やURLの存在チェック
    const photoHtml = guest.photo && guest.photo.url
      ? `<img src="${guest.photo.url}" alt="${guest.name}" />` : '';
    const instaHtml = guest.instagram_url
      ? `<a class="insta" href="${guest.instagram_url}" target="_blank" rel="noopener">公式Instagram</a>` : '';

    const article = document.createElement('article');
    article.className = 'cast-item fade show';
    article.tabIndex = 0;

    article.innerHTML = `
      <div class="card">
        <div class="card-face card-front">
          <span class="rank">${rankNumber}<br />${rankSymbol}</span>
          <span class="symbol">${rankSymbol}</span>
          <span class="title">${guest.name}</span>
          <span class="rank bottom">${rankNumber}<br />${rankSymbol}</span>
        </div>
        <div class="card-face card-back">
          ${photoHtml}
          <h3>${guest.name}</h3>
          <p>${guest.description || ''}</p>
          ${instaHtml}
        </div>
      </div>
    `;

    // スマホ等のタップ用裏返し対応
    article.addEventListener('click', () => {
      if (window.matchMedia('(hover: none)').matches) {
        article.classList.toggle('is-flipped');
      }
    });

    grid.appendChild(article);
  });
}

// ブラウザでのページ読み込みが完了したタイミングで上記の関数を実行
window.addEventListener('load', fetchSpecialGuests);
```

> [!NOTE]
> 外部の `script.js` にこのコードを書いた場合は、必ず `index.html` の末尾で `<script src="script.js"></script>` のようにファイルを読み込んでください。読み込まれていないと実行されません。

---

## 4. Netlify（ホスティングサーバー）でのWebhook連携設定

HTMLやJSの設定が完了したら、microCMS上で記事を追加・更新したタイミングで、自動的にお客様のサイトが最新状態に書き換わるように設定します。

1. **Netlify側:** 管理画面の `Site configuration` > `Build & deploy` > `Build hooks` にてフックURL（Webhook用URL）を発行・コピーします。
2. **microCMS側:** 管理画面の右上の `API設定` > `Webhook` にて、「カスタム通知」またはNetlify連携用メニューを追加し、トリガー（コンテンツの公開・非公開など）にチェックを入れて先ほどのフックURLを貼り付けます。

これで、microCMSで情報を更新するたびにサイトへ自動反映されるようになります。
