/**
 * Templates visuais HTML/CSS para os posts de redes sociais do MeuPlantão.
 * 
 * Garante fidelidade 100% à marca:
 * - Logotipo vetorial oficial embutido (Calendário com pulso verde)
 * - Tipografia Plus Jakarta Sans & Inter
 * - Paleta oficial (Navy Cirúrgico #0B132B / #0F172A, Verde Saldo #22C55E, Âmbar #F59E0B)
 * - Proporção padrão 4:5 (1080x1350) e 1:1 (1080x1080)
 */

export const BRAND_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 90" fill="none" class="brand-logo">
  <!-- SÍMBOLO: CALENDÁRIO COM PULSO -->
  <g transform="translate(10, 8)">
    <rect x="20" y="2" width="7" height="16" rx="3.5" fill="#FFFFFF"/>
    <rect x="47" y="2" width="7" height="16" rx="3.5" fill="#FFFFFF"/>
    <rect x="6" y="9" width="62" height="60" rx="16" stroke="#FFFFFF" stroke-width="8" fill="none"/>
    <path d="M-2 42H18L24 30L32 58L40 22L47 50L51 38L55 42H76" 
          stroke="#22C55E" 
          stroke-width="6" 
          stroke-linecap="round" 
          stroke-linejoin="round"/>
  </g>
  <!-- TIPOGRAFIA: MeuPlantão -->
  <text x="96" y="55" font-family="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif" font-size="42" font-weight="800" letter-spacing="-1.5">
    <tspan fill="#FFFFFF">Meu</tspan><tspan fill="#22C55E">Plantão</tspan>
  </text>
</svg>
`;

export const BASE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    -webkit-font-smoothing: antialiased;
  }

  body {
    width: 1080px;
    height: 1350px;
    overflow: hidden;
    background: #0B132B;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FFFFFF;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* Grid de fundo sutil cirúrgico */
  .bg-canvas {
    position: absolute;
    inset: 0;
    background: 
      radial-gradient(circle at 80% 20%, rgba(34, 197, 94, 0.12) 0%, transparent 40%),
      radial-gradient(circle at 10% 80%, rgba(6, 182, 212, 0.08) 0%, transparent 40%),
      linear-gradient(180deg, #070D1E 0%, #0B132B 50%, #050914 100%);
    z-index: 1;
  }

  .bg-grid {
    position: absolute;
    inset: 0;
    background-image: 
      linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
    background-size: 60px 60px;
    z-index: 2;
  }

  .content-container {
    position: relative;
    z-index: 10;
    width: 100%;
    height: 100%;
    padding: 70px 80px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .header .brand-logo {
    width: 260px;
    height: auto;
  }

  .badge {
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: #22C55E;
    font-size: 20px;
    font-weight: 700;
    padding: 10px 22px;
    border-radius: 9999px;
    text-transform: uppercase;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge-pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #22C55E;
    box-shadow: 0 0 12px #22C55E;
  }

  /* Footer */
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 30px;
  }

  .profile-tag {
    font-size: 24px;
    font-weight: 700;
    color: #94A3B8;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .profile-tag span {
    color: #FFFFFF;
  }

  .swipe-indicator {
    font-size: 22px;
    font-weight: 700;
    color: #22C55E;
    background: rgba(34, 197, 94, 0.1);
    padding: 12px 24px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .progress-dots {
    display: flex;
    gap: 8px;
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
  }

  .dot.active {
    width: 36px;
    border-radius: 6px;
    background: #22C55E;
    box-shadow: 0 0 10px rgba(34, 197, 94, 0.5);
  }
`;

/**
 * Template: Capa de Carrossel (Cover Slide)
 */
export function renderCoverTemplate(data) {
  const {
    badge = 'Gestão de Plantões',
    title = '3 passos para nunca mais esquecer um plantão ou repasse',
    subtitle = 'O método simples para organizar seus recebimentos em múltiplos hospitais.',
    totalSlides = 5,
    highlightWords = []
  } = data;

  // Destacar palavras-chave se fornecidas
  let formattedTitle = title;
  highlightWords.forEach(word => {
    const regex = new RegExp(`(${word})`, 'gi');
    formattedTitle = formattedTitle.replace(regex, '<span style="color: #22C55E;">$1</span>');
  });

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    ${BASE_STYLES}

    .main-body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 36px;
      margin-top: -40px;
    }

    .title {
      font-size: 64px;
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -2px;
      color: #FFFFFF;
      max-width: 900px;
    }

    .subtitle-box {
      background: rgba(255, 255, 255, 0.04);
      border-left: 5px solid #22C55E;
      padding: 24px 32px;
      border-radius: 0 16px 16px 0;
      backdrop-filter: blur(8px);
      max-width: 860px;
    }

    .subtitle {
      font-size: 28px;
      font-weight: 500;
      line-height: 1.45;
      color: #CBD5E1;
    }
  </style>
</head>
<body>
  <div class="bg-canvas"></div>
  <div class="bg-grid"></div>

  <div class="content-container">
    <!-- Header -->
    <div class="header">
      ${BRAND_LOGO_SVG}
      <div class="badge">
        <div class="badge-pulse"></div>
        ${badge}
      </div>
    </div>

    <!-- Main Content -->
    <div class="main-body">
      <h1 class="title">${formattedTitle}</h1>
      ${subtitle ? `
        <div class="subtitle-box">
          <p class="subtitle">${subtitle}</p>
        </div>
      ` : ''}
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="profile-tag">
        @meuplantao.pro • <span>meuplantao.pro</span>
      </div>
      <div class="swipe-indicator">
        arrasta pro lado 👉
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Template: Slide Informativo / Passo a Passo (Step Slide)
 */
export function renderStepTemplate(data) {
  const {
    stepNumber = 1,
    totalSteps = 3,
    currentSlide = 2,
    totalSlides = 5,
    stepTag = `Passo ${stepNumber} de ${totalSteps}`,
    title = 'Registre o plantão e a data prevista',
    description = 'Local + data + valor + quando deveria cair. 30 segundos no celular e está guardado.',
    highlightBox = null,
    badge = 'Passo a Passo'
  } = data;

  const dotsHtml = Array.from({ length: totalSlides }, (_, i) => {
    return `<div class="dot ${i + 1 === currentSlide ? 'active' : ''}"></div>`;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    ${BASE_STYLES}

    .main-body {
      display: flex;
      flex-direction: column;
      gap: 32px;
      margin-top: -20px;
    }

    .step-pill {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: #1E293B;
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 10px 24px;
      border-radius: 12px;
      font-size: 22px;
      font-weight: 700;
      color: #94A3B8;
      width: fit-content;
    }

    .step-number-badge {
      background: #22C55E;
      color: #070D1E;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
    }

    .step-title {
      font-size: 54px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -1.5px;
      color: #FFFFFF;
    }

    .step-desc {
      font-size: 30px;
      font-weight: 500;
      line-height: 1.5;
      color: #CBD5E1;
      max-width: 900px;
    }

    .highlight-card {
      background: rgba(34, 197, 94, 0.06);
      border: 1px solid rgba(34, 197, 94, 0.25);
      border-radius: 20px;
      padding: 28px 36px;
      margin-top: 10px;
      max-width: 900px;
    }

    .highlight-card-title {
      font-size: 24px;
      font-weight: 700;
      color: #22C55E;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .highlight-card-text {
      font-size: 24px;
      font-weight: 500;
      color: #E2E8F0;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="bg-canvas"></div>
  <div class="bg-grid"></div>

  <div class="content-container">
    <!-- Header -->
    <div class="header">
      ${BRAND_LOGO_SVG}
      <div class="badge">
        <div class="badge-pulse"></div>
        ${badge}
      </div>
    </div>

    <!-- Main Content -->
    <div class="main-body">
      <div class="step-pill">
        <div class="step-number-badge">${stepNumber}</div>
        ${stepTag}
      </div>

      <h2 class="step-title">${title}</h2>
      <p class="step-desc">${description}</p>

      ${highlightBox ? `
        <div class="highlight-card">
          <div class="highlight-card-title">${highlightBox.title}</div>
          <div class="highlight-card-text">${highlightBox.text}</div>
        </div>
      ` : ''}
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="profile-tag">
        @meuplantao.pro
      </div>
      <div class="progress-dots">
        ${dotsHtml}
      </div>
      <div class="swipe-indicator">
        👉
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Template: Slide Final de Fechamento com CTA (Closing Slide)
 */
export function renderClosingTemplate(data) {
  const {
    currentSlide = 5,
    totalSlides = 5,
    headline = 'Plantão batido, valor registrado, repasse cobrado.',
    ctaTitle = 'Comece a organizar seus plantões hoje',
    ctaUrl = 'www.meuplantao.pro',
    bulletPoints = [
      'Controle em múltiplos hospitais',
      'Cálculo automático de saldos e atrasos',
      'Acesso 100% gratuito e seguro no celular'
    ],
    badge = 'Resultado'
  } = data;

  const dotsHtml = Array.from({ length: totalSlides }, (_, i) => {
    return `<div class="dot ${i + 1 === currentSlide ? 'active' : ''}"></div>`;
  }).join('');

  const bulletsHtml = bulletPoints.map(pt => `
    <div class="bullet-item">
      <div class="bullet-check">✓</div>
      <div class="bullet-text">${pt}</div>
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    ${BASE_STYLES}

    .main-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 36px;
      margin-top: -30px;
    }

    .headline {
      font-size: 48px;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -1.5px;
      color: #FFFFFF;
      max-width: 860px;
    }

    .bullets-container {
      display: flex;
      flex-direction: column;
      gap: 18px;
      text-align: left;
      width: 100%;
      max-width: 780px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 32px 40px;
    }

    .bullet-item {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .bullet-check {
      background: #22C55E;
      color: #070D1E;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 18px;
      flex-shrink: 0;
    }

    .bullet-text {
      font-size: 26px;
      font-weight: 600;
      color: #F1F5F9;
    }

    .cta-card {
      background: linear-gradient(135deg, #16A34A 0%, #22C55E 100%);
      padding: 24px 48px;
      border-radius: 20px;
      color: #070D1E;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      box-shadow: 0 12px 36px rgba(34, 197, 94, 0.35);
      margin-top: 10px;
    }

    .cta-title {
      font-size: 24px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .cta-url {
      font-size: 34px;
      font-weight: 900;
      letter-spacing: -0.5px;
    }
  </style>
</head>
<body>
  <div class="bg-canvas"></div>
  <div class="bg-grid"></div>

  <div class="content-container">
    <!-- Header -->
    <div class="header">
      ${BRAND_LOGO_SVG}
      <div class="badge">
        <div class="badge-pulse"></div>
        ${badge}
      </div>
    </div>

    <!-- Main Content -->
    <div class="main-body">
      <h2 class="headline">${headline}</h2>
      
      <div class="bullets-container">
        ${bulletsHtml}
      </div>

      <div class="cta-card">
        <div class="cta-title">${ctaTitle}</div>
        <div class="cta-url">${ctaUrl}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="profile-tag">
        @meuplantao.pro
      </div>
      <div class="progress-dots">
        ${dotsHtml}
      </div>
      <div class="swipe-indicator" style="background: rgba(255,255,255,0.08); color: #FFF;">
        Salvar post 📌
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Template: Post Estático de Conscientização / Dor (Static Impact Post)
 */
export function renderStaticQuoteTemplate(data) {
  const {
    badge = 'Conscientização',
    quote = 'Aquele plantão de 3 meses atrás... já caiu na sua conta?',
    subtext = 'Se você precisou pensar para responder, você precisa de controle.',
    cta = 'Teste grátis: www.meuplantao.pro'
  } = data;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    ${BASE_STYLES}

    .main-body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      gap: 40px;
      margin-top: -40px;
    }

    .quote-mark {
      font-size: 110px;
      color: #22C55E;
      line-height: 0.5;
      font-family: serif;
      opacity: 0.8;
    }

    .quote-title {
      font-size: 60px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -2px;
      color: #FFFFFF;
      max-width: 900px;
    }

    .subtext-box {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 20px 36px;
      max-width: 800px;
    }

    .subtext {
      font-size: 26px;
      font-weight: 500;
      color: #94A3B8;
    }
  </style>
</head>
<body>
  <div class="bg-canvas"></div>
  <div class="bg-grid"></div>

  <div class="content-container">
    <!-- Header -->
    <div class="header">
      ${BRAND_LOGO_SVG}
      <div class="badge">
        <div class="badge-pulse"></div>
        ${badge}
      </div>
    </div>

    <!-- Main Content -->
    <div class="main-body">
      <div class="quote-mark">“</div>
      <h1 class="quote-title">${quote}</h1>
      <div class="subtext-box">
        <p class="subtext">${subtext}</p>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="profile-tag">
        @meuplantao.pro • <span>${cta}</span>
      </div>
      <div class="swipe-indicator" style="background: rgba(255,255,255,0.08); color: #FFF;">
        Salvar 📌
      </div>
    </div>
  </div>
</body>
</html>
  `;
}
