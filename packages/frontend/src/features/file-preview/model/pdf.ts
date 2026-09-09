export interface PdfOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: PdfOutlineItem[];
}

export interface PdfSearchMatch {
  page: number;
  occurrence: number;
}
