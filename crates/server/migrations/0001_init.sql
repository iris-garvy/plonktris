--
-- PostgreSQL database dump
--

\restrict pVk5rIccjcWKjuBaioccHH6AIzIag8TARccVrnu0fbFmLuqLDSvTg74GjdO7QMt

-- Dumped from database version 16.14 (Homebrew)
-- Dumped by pg_dump version 16.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board bytea NOT NULL,
    queue bytea NOT NULL,
    requirements bytea NOT NULL,
    actions bytea,
    submitted timestamp without time zone DEFAULT now(),
    status text DEFAULT 'pending'::text NOT NULL,
    puzzle_id uuid,
    failed_reason text,
    user_id uuid,
    target_puzzle_id uuid,
    name text
);


--
-- Name: puzzles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.puzzles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board bytea NOT NULL,
    queue bytea NOT NULL,
    requirements bytea NOT NULL,
    proof bytea NOT NULL,
    num_pieces integer NOT NULL,
    tss integer DEFAULT 0 NOT NULL,
    tsd integer DEFAULT 0 NOT NULL,
    tst integer DEFAULT 0 NOT NULL,
    attack integer DEFAULT 0 NOT NULL,
    pc integer DEFAULT 0 NOT NULL,
    tetris integer DEFAULT 0 NOT NULL,
    submitted timestamp without time zone DEFAULT now(),
    max_combo integer DEFAULT 0 NOT NULL,
    no_hold boolean DEFAULT false NOT NULL,
    ruleset text DEFAULT 'srs'::text NOT NULL,
    name text DEFAULT 'untitled'::text NOT NULL,
    creator_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    featured boolean DEFAULT false NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: solves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    puzzle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    first_solve boolean DEFAULT false NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: puzzles puzzles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.puzzles
    ADD CONSTRAINT puzzles_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token);


--
-- Name: solves solves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solves
    ADD CONSTRAINT solves_pkey PRIMARY KEY (id);


--
-- Name: solves solves_puzzle_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solves
    ADD CONSTRAINT solves_puzzle_id_user_id_key UNIQUE (puzzle_id, user_id);


--
-- Name: solves solves_puzzle_id_user_id_key1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solves
    ADD CONSTRAINT solves_puzzle_id_user_id_key1 UNIQUE (puzzle_id, user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: puzzles_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX puzzles_created_idx ON public.puzzles USING btree (created_at DESC);


--
-- Name: puzzles_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX puzzles_identity_idx ON public.puzzles USING btree (md5(((board || queue) || requirements)));


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);


--
-- Name: solves_puzzle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solves_puzzle_idx ON public.solves USING btree (puzzle_id);


--
-- Name: jobs jobs_puzzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_puzzle_id_fkey FOREIGN KEY (puzzle_id) REFERENCES public.puzzles(id);


--
-- Name: jobs jobs_target_puzzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_target_puzzle_id_fkey FOREIGN KEY (target_puzzle_id) REFERENCES public.puzzles(id);


--
-- Name: jobs jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: puzzles puzzles_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.puzzles
    ADD CONSTRAINT puzzles_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: solves solves_puzzle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solves
    ADD CONSTRAINT solves_puzzle_id_fkey FOREIGN KEY (puzzle_id) REFERENCES public.puzzles(id) ON DELETE CASCADE;


--
-- Name: solves solves_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solves
    ADD CONSTRAINT solves_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict pVk5rIccjcWKjuBaioccHH6AIzIag8TARccVrnu0fbFmLuqLDSvTg74GjdO7QMt

