import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { loadHoldings, loadIndex, type DataIndex } from './data';
import { effectiveMode, findNames, normalizeName, rankRows, type Holding, type NameEntry, type SortMode } from './holdings.mjs';

type Sheet = { type: 'holding'; row: Holding } | { type: 'about' } | { type: 'privacy' };
type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'medium' | 'large'; variant?: 'weak' | 'primary'; fullWidth?: boolean };
const examples = ['삼성전자', 'SK하이닉스', '한미반도체', 'NVIDIA CORP'];
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const metricLabel: Record<SortMode, string> = { weight: '보유비중', amount: '추정 보유금액', count: '보유수량 / 1CU' };
const dateLabel = (date: string) => date.replaceAll('-', '.');
const displayNumber = (value: number | null, unit = '') => value === null ? '미제공' : `${number.format(value)}${unit}`;
const metricValue = (row: Holding, mode: SortMode) => mode === 'weight' ? row.weight : mode === 'amount' ? row.amount : row.count;
const displayMetric = (row: Holding, mode: SortMode) => displayNumber(metricValue(row, mode), mode === 'weight' ? '%' : mode === 'amount' ? '억 원' : '');

function ActionButton({ size = 'large', variant = 'weak', fullWidth = false, className = '', ...props }: ActionButtonProps) {
  return <button className={`action-button action-button-${size} action-button-${variant}${fullWidth ? ' action-button-full' : ''} ${className}`.trim()} {...props} />;
}

function SearchIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2" /><path d="m16 16 4.3 4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function Chevron({ down = false }: { down?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={down ? 'm5 8 5 5 5-5' : 'm8 5 5 5-5 5'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function BasketArt() {
  return <svg className="basket-art" viewBox="0 0 220 200" fill="none" role="img" aria-label="다양한 종목을 담은 ETF 바구니">
    <defs>
      <linearGradient id="basket" x1="51" y1="101" x2="181" y2="193" gradientUnits="userSpaceOnUse"><stop stopColor="#5BA2FF" /><stop offset="1" stopColor="#1B64DA" /></linearGradient>
      <linearGradient id="coin" x1="134" y1="24" x2="178" y2="90" gradientUnits="userSpaceOnUse"><stop stopColor="#FFE295" /><stop offset="1" stopColor="#FFBA42" /></linearGradient>
      <filter id="art-shadow" x="0" y="0" width="220" height="220" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#497EB8" floodOpacity=".12" /></filter>
    </defs>
    <ellipse cx="128" cy="184" rx="72" ry="10" fill="#C8DEFA" opacity=".55" />
    <g filter="url(#art-shadow)">
      <g transform="rotate(-15 76 83)"><rect x="45" y="46" width="60" height="84" rx="12" fill="white" /><rect x="54" y="57" width="25" height="6" rx="3" fill="#C2D8F8" /><rect x="54" y="71" width="41" height="5" rx="2.5" fill="#E2EDFF" /><path d="m58 107 10-13 10 6 14-22" stroke="#5399F7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></g>
      <circle cx="159" cy="61" r="30" fill="url(#coin)" /><circle cx="159" cy="61" r="23" stroke="#FFF0BD" strokeWidth="2" /><path d="m149 51 4 19 6-14 6 14 4-19" stroke="#D59329" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m75 112 39-41a9 9 0 0 1 13 0l40 41" stroke="#2F76DD" strokeWidth="10" strokeLinecap="round" />
      <path d="M48 109h145l-15 58a17 17 0 0 1-16 13H79a17 17 0 0 1-16-13z" fill="url(#basket)" />
      <rect x="42" y="102" width="157" height="17" rx="8.5" fill="#75B1FF" />
      <path d="M91 134v26m29-26v26m29-26v26" stroke="#B7D8FF" strokeWidth="8" strokeLinecap="round" />
    </g>
    <path d="m32 29 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#77ADFA" /><circle cx="199" cy="97" r="4" fill="#96C0FF" />
  </svg>;
}

function Status({ title, description, retry }: { title: string; description?: string; retry?: () => void }) {
  return <div className="status-card" role="status"><div className="status-icon">!</div><strong>{title}</strong>{description && <p>{description}</p>}{retry && <ActionButton size="medium" onClick={retry}>다시 시도하기</ActionButton>}</div>;
}

function App() {
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [indexError, setIndexError] = useState('');
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexAttempt, setIndexAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [activeOption, setActiveOption] = useState(-1);
  const [selected, setSelected] = useState<NameEntry | null>(null);
  const [rows, setRows] = useState<Holding[]>([]);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState('');
  const [sort, setSort] = useState<SortMode>('weight');
  const [visibleCount, setVisibleCount] = useState(20);
  const [missingOpen, setMissingOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestId = useRef(0);
  const composing = useRef(false);
  const suggestions = useMemo(() => findNames(index?.names ?? [], query), [index, query]);
  const suggestionsOpen = focused && query.trim().length > 0 && !isComposing;
  const mode = effectiveMode(rows, sort);
  const { ranked, missing } = useMemo(() => rankRows(rows, mode), [rows, mode]);
  const hasAmount = rows.some((row) => row.amount !== null);
  const allWeightsMissing = rows.length > 0 && rows.every((row) => row.weight === null);
  const first = ranked[0];

  useEffect(() => {
    let current = true;
    setIndexLoading(true);
    setIndexError('');
    loadIndex().then((loaded) => { if (current) setIndex(loaded); }).catch((error: Error) => {
      if (current) setIndexError(error.message);
    }).finally(() => { if (current) setIndexLoading(false); });
    return () => { current = false; };
  }, [indexAttempt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (sheet) {
      if (!dialog.open) dialog.showModal();
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = previous; };
    }
    if (dialog.open) dialog.close();
  }, [sheet]);

  async function selectName(entry: NameEntry) {
    const id = ++requestId.current;
    setSelected(entry);
    setQuery(entry[0]);
    setFocused(false);
    setActiveOption(-1);
    setRows([]);
    setResultLoading(true);
    setResultError('');
    setSort('weight');
    setVisibleCount(20);
    setMissingOpen(false);
    inputRef.current?.blur();
    try {
      const holdings = await loadHoldings(entry[0]);
      if (id !== requestId.current) return;
      setRows(holdings);
      setAnnouncement(`${entry[0]} 보유 ETF ${holdings.length}개를 찾았어요.`);
    } catch (error) {
      if (id === requestId.current) setResultError(error instanceof Error ? error.message : '데이터를 불러오지 못했어요.');
    } finally {
      if (id === requestId.current) setResultLoading(false);
    }
  }

  function editQuery(value: string) {
    ++requestId.current;
    setQuery(value);
    setSelected(null);
    setRows([]);
    setResultLoading(false);
    setResultError('');
    setFocused(true);
    setActiveOption(-1);
  }

  function submitSearch() {
    if (composing.current) return;
    const exact = suggestions.find(([name]) => normalizeName(name) === normalizeName(query));
    const entry = activeOption >= 0 ? suggestions[activeOption] : exact ?? suggestions[0];
    if (entry) void selectName(entry);
    else setAnnouncement('일치하는 종목이 없어요. 종목명을 다시 확인해 주세요.');
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault(); setFocused(true); setActiveOption((option) => Math.min(option + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); setActiveOption((option) => Math.max(option - 1, 0));
    } else if (event.key === 'Escape') {
      setFocused(false); setActiveOption(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault(); submitSearch();
    }
  }

  function chooseSort(next: SortMode) {
    setSort(next); setVisibleCount(20); setMissingOpen(false);
  }

  function rowButton(row: Holding, rank?: number) {
    const value = metricValue(row, mode);
    return <button key={row.code} className="holding-row" onClick={() => setSheet({ type: 'holding', row })} aria-label={`${rank ? `${rank}위, ` : ''}${row.name}, ${metricLabel[mode]} ${displayMetric(row, mode)}, 자세히 보기`}>
      {rank && <span className={`row-rank ${rank <= 3 ? 'row-rank-top' : ''}`}>{rank}</span>}
      <span className="row-content"><span className="row-topline"><span className="row-name">{row.name}</span><span className={`row-metric ${value === null ? 'unavailable' : ''}`}>{displayMetric(row, mode)}</span></span><span className="row-code">{row.code}</span>
        {mode === 'weight' && value !== null && <span className="weight-track"><span style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} /></span>}
      </span><span className="row-chevron"><Chevron /></span>
    </button>;
  }

  return <>
    <main className="app-shell">
      <header className="hero">
        <div className="eyebrow"><span className="eyebrow-icon"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 12V7m5 5V3m5 9V5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg></span>ETF 보유비중 검색</div>
        <h1>이 종목을 가장 많이{' '}<br />보유한 <span>ETF는?</span></h1>
        <p className="hero-description">관심 종목 하나로,<br />국내 상장 ETF를 한눈에 비교해요.</p>
      </header>

      <section className="search-section" aria-label="종목 검색">
        <form className="search-form" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
          <label className="sr-only" htmlFor="stock-search">종목명 검색</label>
          <div className={`search-box ${focused ? 'search-box-focused' : ''}`}>
            <button className="search-submit" type="submit" aria-label="종목 검색" disabled={!index}><SearchIcon /></button>
            <input ref={inputRef} id="stock-search" type="search" role="combobox" value={query} placeholder="어떤 종목이 궁금하세요?" autoComplete="off" spellCheck={false}
              disabled={!index} aria-autocomplete="list" aria-expanded={suggestionsOpen} aria-controls="stock-suggestions"
              aria-activedescendant={suggestionsOpen && activeOption >= 0 ? `suggestion-${activeOption}` : undefined}
              onChange={(event) => editQuery(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActiveOption(-1); }}
              onKeyDown={handleSearchKey} onCompositionStart={() => { composing.current = true; setIsComposing(true); }} onCompositionEnd={() => { composing.current = false; setIsComposing(false); }} />
            {query && <button type="button" className="clear-search" aria-label="검색어 지우기" onClick={() => { editQuery(''); inputRef.current?.focus(); }}>×</button>}
          </div>
          {suggestionsOpen && <div className="suggestion-popover">
            <ul id="stock-suggestions" role="listbox" aria-label="일치하는 종목">
              {suggestions.map((entry, i) => <li key={entry[0]} role="option" id={`suggestion-${i}`} aria-selected={activeOption === i}>
                <button type="button" className={`suggestion-item ${activeOption === i ? 'suggestion-active' : ''}`} tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={() => void selectName(entry)}>
                  <span>{entry[0]}</span><span className="suggestion-count">ETF {integer.format(entry[1])}개<Chevron /></span>
                </button>
              </li>)}
            </ul>
            {suggestions.length === 0 && <div className="suggestion-empty"><strong>일치하는 종목이 없어요</strong><p>종목명을 확인해 주세요.<br />해외 종목은 영문명으로 검색할 수 있어요.</p></div>}
          </div>}
        </form>
        {!selected && <div className="quick-search"><p>이 종목부터 찾아보세요</p><div className="example-chips">{examples.map((name) => <button key={name} disabled={!index} onClick={() => {
          const entry = index?.names.find(([stock]) => stock === name);
          if (entry) void selectName(entry);
        }}>{name === 'NVIDIA CORP' ? 'NVIDIA' : name}<span aria-hidden="true">↗</span></button>)}</div></div>}
      </section>

      {indexLoading && <div className="inline-loading" role="status"><span className="spinner" />종목 정보를 불러오고 있어요</div>}
      {indexError && <Status title="잠시 불러오지 못했어요" description={indexError} retry={() => setIndexAttempt((attempt) => attempt + 1)} />}

      {!selected && !indexError && <section className="intro-panel" aria-label="서비스 소개">
        <div className="intro-copy"><span className="intro-tag">내 관심 종목을 담은 ETF</span><h2>종목은 하나,<br />ETF는 다양하게.</h2><p>어떤 ETF가 더 많이 담았는지<br />보유비중으로 확인해 보세요.</p></div><BasketArt />
      </section>}

      {selected && <section className="results" aria-label={`${selected[0]} 보유 ETF`} aria-busy={resultLoading}>
        <div className="result-heading"><p>이 종목을 담은 ETF</p><h2>{selected[0]}<span>{resultLoading ? '…' : `${integer.format(rows.length)}개`}</span></h2></div>
        {resultLoading && <div className="result-skeleton" role="status" aria-label="보유 ETF를 찾고 있어요"><span /><span /><span /></div>}
        {resultError && <Status title="보유 정보를 불러오지 못했어요" description={resultError} retry={() => void selectName(selected)} />}
        {!resultLoading && !resultError && rows.length === 0 && <Status title="아직 보유 정보가 없어요" description="이 종목의 데이터가 없어 비교할 수 없어요. 다른 종목을 검색해 보세요." />}
        {!resultLoading && !resultError && rows.length > 0 && <>
          <div className="sort-bar"><span>어떤 기준으로 볼까요?</span><div className="sort-options" role="group" aria-label="ETF 정렬 기준">
            <button className={sort !== 'amount' ? 'sort-active' : ''} aria-pressed={sort !== 'amount'} onClick={() => chooseSort('weight')}>{allWeightsMissing ? '수량순' : '비중순'}</button>
            <button className={sort === 'amount' ? 'sort-active' : ''} aria-pressed={sort === 'amount'} disabled={!hasAmount} onClick={() => chooseSort('amount')}>금액순</button>
          </div></div>
          {allWeightsMissing && <p className="data-notice">비중이 제공되지 않아 1CU당 보유수량으로 표시해요. ETF마다 1CU 규모가 달라 수량만으로 비중을 비교할 수 없어요.{!hasAmount && ' 금액도 제공되지 않아요.'}</p>}
          {mode === 'amount' && <p className="data-notice">보유비중 × ETF 시가총액으로 계산한 추정금액이에요.</p>}
          {first && <button className="top-holding" onClick={() => setSheet({ type: 'holding', row: first })} aria-label={`${mode === 'weight' ? '보유비중 1위' : mode === 'amount' ? '추정 보유금액 1위' : '1CU당 보유수량순 첫 번째'}, ${first.name}, ${displayMetric(first, mode)}, 자세히 보기`}>
            <span className="top-badge"><svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m3 5 3 3 3-5 3 5 3-3-2 8H5z" fill="currentColor" /></svg>{mode === 'weight' ? '가장 높은 보유비중' : mode === 'amount' ? '가장 큰 추정 보유금액' : '1CU당 보유수량순'}</span>
            <span className="top-title">{first.name}</span><span className="top-code">{first.code}</span>
            <span className="top-bottom"><span><span className="top-label">{metricLabel[mode]}</span><strong className="top-value">{displayMetric(first, mode)}</strong></span><span className="top-detail">보유정보<Chevron /></span></span>
          </button>}
          {ranked.length > 1 && <div className="ranking-list"><div className="list-heading"><span>보유 ETF 비교</span><span>{metricLabel[mode]}</span></div>{ranked.slice(1, visibleCount).map((row, i) => rowButton(row, i + 2))}</div>}
          {ranked.length > visibleCount && <div className="more-button"><ActionButton fullWidth onClick={() => setVisibleCount((count) => count + 20)}>ETF 더 보기 · {integer.format(ranked.length - visibleCount)}개</ActionButton></div>}
          {missing.length > 0 && <div className="missing-section"><button className="missing-toggle" aria-expanded={missingOpen} onClick={() => setMissingOpen((open) => !open)}><span>{metricLabel[mode]} 미제공 ETF <b>{missing.length}개</b></span><Chevron down /></button>{missingOpen && <div className="missing-list"><p>선택한 기준의 데이터가 없어 순위에 포함하지 않았어요.</p>{missing.map((row) => rowButton(row))}</div>}</div>}
          <p className="result-hint">ETF를 누르면 자세한 보유정보를 볼 수 있어요.</p>
        </>}
      </section>}

      {!selected && index && <div className="data-stats"><div><strong>{integer.format(index.meta.etfCount)}</strong><span>국내 상장 ETF</span></div><span className="stats-divider" /><div><strong>{integer.format(index.meta.stockCount)}</strong><span>검색 가능한 구성종목</span></div></div>}
      <footer className="app-footer">
        {index && <p className="data-date"><span />{dateLabel(index.meta.baseDate)} 기준 데이터</p>}
        <div className="footer-links"><button onClick={() => setSheet({ type: 'about' })}>데이터 출처 · 산출 기준</button><span>·</span><button onClick={() => setSheet({ type: 'privacy' })}>개인정보 안내</button></div>
        <p className="footer-note">ETF 구성정보를 비교하는 서비스예요.<br />정보 제공 목적이며 투자 권유가 아니에요.</p>
      </footer>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
    </main>

    <dialog ref={dialogRef} className="detail-sheet" aria-labelledby="sheet-title" onCancel={(event) => { event.preventDefault(); setSheet(null); }} onClick={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
      {sheet && <div className="sheet-content"><div className="sheet-handle" /><button className="sheet-close" aria-label="닫기" onClick={() => setSheet(null)} autoFocus>×</button>
        {sheet.type === 'holding' && <><span className="sheet-eyebrow">ETF 보유정보</span><h2 id="sheet-title">{sheet.row.name}</h2><p className="sheet-code">종목코드 {sheet.row.code}</p><div className="detail-highlight"><span>{selected?.[0]} 보유비중</span><strong>{displayNumber(sheet.row.weight, '%')}</strong></div>
          <dl className="detail-values"><div><dt>추정 보유금액</dt><dd>{displayNumber(sheet.row.amount, '억 원')}</dd></div><div><dt>보유수량 / 1CU</dt><dd>{displayNumber(sheet.row.count)}</dd></div><div><dt>ETF 시가총액</dt><dd>{displayNumber(sheet.row.marketSum, '억 원')}</dd></div><div><dt>데이터 기준일</dt><dd>{index ? dateLabel(index.meta.baseDate) : '—'}</dd></div></dl>
          <p className="sheet-notice">1CU는 ETF의 설정단위예요. ETF마다 규모가 달라 보유수량을 직접 비교하는 데 한계가 있어요. 추정 보유금액은 보유비중 × ETF 시가총액으로 계산해요.</p></>}
        {sheet.type === 'about' && <><span className="sheet-eyebrow">데이터 안내</span><h2 id="sheet-title">어떤 데이터인가요?</h2><div className="sheet-prose"><h3>데이터 출처</h3><p>기존 ETF 파인더에서 수집한 네이버 금융·WiseReport의 국내 상장 ETF 구성종목 데이터를 사용해요. 동일한 종목도 제공처의 표기에 따라 영문명·철자가 다르면 별도로 검색돼요.</p><h3>비교 기준</h3><p>비중순은 ETF에서 해당 종목이 차지하는 비율이 높은 순서예요. 금액순은 보유비중에 ETF 시가총액을 곱한 추정 보유금액 순서예요.</p><p>비중이 모두 미제공인 종목은 1CU당 보유수량순으로 보여줘요. ETF마다 CU 규모가 달라 보유수량이 많다고 더 높은 비중을 의미하지는 않아요. 선택한 기준의 값이 없는 ETF는 순위에서 분리해요.</p><h3>데이터 기준일</h3><p>{index ? `${dateLabel(index.meta.baseDate)} 기준 데이터를 조회하고 있어요.` : '불러온 데이터의 기준일을 화면 하단에서 확인해 주세요.'} 현재 가격이나 실시간 보유내역과 차이가 있을 수 있어요.</p><h3>이용 안내</h3><p>정보 제공 목적으로 제공하며 투자 권유가 아니에요. 데이터에 오류나 누락이 있을 수 있으니 투자 판단 시 운용사의 최신 공시를 함께 확인해 주세요.</p></div></>}
        {sheet.type === 'privacy' && <><span className="sheet-eyebrow">개인정보 안내</span><h2 id="sheet-title">검색어는 저장하지 않아요</h2><div className="sheet-prose"><p>이 웹사이트는 회원가입 없이 이용할 수 있으며 이름·연락처 등 개인정보를 직접 수집하지 않아요.</p><h3>검색과 이용기록</h3><p>종목명 검색은 브라우저 안에서 처리하고 검색 기록을 별도로 저장하지 않아요. 광고·분석 도구와 추적 쿠키를 사용하지 않아요.</p><h3>정적 데이터 파일 요청</h3><p>ETF 데이터 파일을 GitHub Pages에서 내려받기 위한 요청이 발생해요. GitHub는 서비스 제공과 보안을 위해 접속 기록을 처리할 수 있어요. 검색어는 데이터 파일 요청에 포함되지 않아요.</p></div></>}
        <div className="sheet-action"><ActionButton variant="primary" fullWidth onClick={() => setSheet(null)}>확인했어요</ActionButton></div>
      </div>}
    </dialog>
  </>;
}

export default App;
