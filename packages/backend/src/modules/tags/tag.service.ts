export interface Tag {
  id: number;
  name: string;
}

export interface TagService {
  list(): Promise<Tag[]>;
}
