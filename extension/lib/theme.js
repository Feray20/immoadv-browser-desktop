// ImmoAdv-Fade-Farben für den ganzen Browser (offizielle Design-Schnittstelle von Firefox).
'use strict';
const Theme = (() => {
  // Immer hell (Feray 03.11.2026: „Browser bitte immer hell lassen“) – ImmoAdv-Blau als Akzent, unabhängig vom System.
  const FADE = {
    colors: {
      frame: '#E9EFF8', frame_inactive: '#EEF2F8',
      tab_background_text: '#475569', tab_text: '#0F172A', tab_selected: '#FFFFFF',
      tab_line: '#1E6FD9', tab_loading: '#1E6FD9', tab_background_separator: 'rgba(0,0,0,0)',
      toolbar: '#FFFFFF', toolbar_text: '#0F172A', toolbar_top_separator: 'rgba(0,0,0,0)', toolbar_bottom_separator: '#E2E8F0',
      toolbar_vertical_separator: '#E2E8F0',
      toolbar_field: '#F1F5F9', toolbar_field_text: '#0F172A', toolbar_field_border: '#E2E8F0',
      toolbar_field_focus: '#FFFFFF', toolbar_field_text_focus: '#0F172A', toolbar_field_border_focus: '#1E6FD9',
      toolbar_field_highlight: 'rgba(30,111,217,0.25)', toolbar_field_highlight_text: '#0F172A',
      button_background_hover: 'rgba(15,44,89,0.07)', button_background_active: 'rgba(15,44,89,0.12)',
      icons: '#334155', icons_attention: '#1E6FD9', bookmark_text: '#334155',
      popup: '#FFFFFF', popup_text: '#0F172A', popup_border: '#E2E8F0', popup_highlight: '#EEF3FA', popup_highlight_text: '#0F172A',
      sidebar: '#F8FAFC', sidebar_text: '#0F172A', sidebar_border: '#E2E8F0', sidebar_highlight: 'rgba(30,111,217,0.14)', sidebar_highlight_text: '#0F172A',
      ntp_background: '#F6F9FE', ntp_text: '#0F172A'
    },
    properties: { color_scheme: 'light', content_color_scheme: 'light' }
  };
  async function apply() { try { await browser.theme.update(FADE); } catch (e) { console.warn('Design', e); } }
  return { apply };
})();
