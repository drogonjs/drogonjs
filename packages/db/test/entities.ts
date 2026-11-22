import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from '../src';

export enum Role {
  Admin = 'admin',
  Member = 'member'
}

/** Shared base columns, to cover inherited metadata. */
export abstract class Timestamped {
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('users')
export class User extends Timestamped {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true, length: 120 })
  email!: string;

  @Column({ nullable: true })
  age!: number | null;

  @Column({ default: true })
  active!: boolean;

  @Column({ type: 'enum', enum: Role, default: Role.Member })
  role!: Role;

  @Column({ type: 'json', nullable: true })
  settings!: { theme: string } | null;

  @OneToMany(() => Post, post => post.author)
  posts!: Post[];

  @OneToOne(() => Profile, profile => profile.user)
  profile!: any;

  greet() {
    return `hi ${this.name}`;
  }
}

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ default: 0 })
  views!: number;

  @ManyToOne(() => User, user => user.posts, { onDelete: 'CASCADE' })
  author!: User;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}

@Entity()
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  bio!: string;

  @OneToOne(() => User, user => user.profile)
  @JoinColumn({ name: 'user_id' })
  user!: User;
}

@Entity('memberships')
@Index(['team', 'userId'], { unique: true })
export class Membership {
  @PrimaryColumn()
  team!: string;

  @PrimaryColumn()
  userId!: number;

  @Column({ name: 'joined_at', type: 'timestamp', nullable: true })
  joinedAt!: Date | null;
}

export const ENTITIES = [User, Post, Profile, Membership];
